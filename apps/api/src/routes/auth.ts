import type { FastifyInstance } from "fastify";
import { ValidationError } from "@omnicloud/core";
import { SESSION_COOKIE } from "@omnicloud/shared";
import type { Container } from "../container";
import { currentUser, issueSessionCookie } from "../auth";
import { createRateLimiter } from "../rate-limit";
import { requireBody, requireString } from "../validation";
import { toStorageDTO, toStorageHealthDTO, toUserDTO } from "../mappers";
import type { TelegramVerifyResponse } from "@omnicloud/shared";

const PHONE_PATTERN = /^\+?[0-9]\d{4,14}$/;

/**
 * Telegram connection + browser session endpoints.
 *
 * Flow: POST /telegram/start sends the login code, POST /telegram/verify
 * checks it, POST /telegram/password completes two-factor sign-in.
 * The MTProto session is stored server-side only and never logged.
 */
export function registerAuthRoutes(app: FastifyInstance, container: Container): void {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 10 });

  // ── Start: send the Telegram confirmation code ───────────────────────────
  app.post("/api/auth/telegram/start", async (request, reply) => {
    limiter(request.ip);
    const body = requireBody(request);
    const phone = requireString(body, "phone");
    if (!PHONE_PATTERN.test(phone)) {
      throw new ValidationError("Please provide a valid phone number in international format");
    }
    await container.connection.startLogin(phone);
    return reply.send({ ok: true });
  });

  // ── Verify the confirmation code ─────────────────────────────────────────
  app.post("/api/auth/telegram/verify", async (request, reply) => {
    limiter(request.ip);
    const body = requireBody(request);
    const phone = requireString(body, "phone");
    const code = requireString(body, "code");
    if (!/^\d{3,10}$/.test(code)) {
      throw new ValidationError("Please provide the numeric Telegram login code");
    }

    const result = await container.connection.verifyCode(phone, code);
    if (result.status === "password_required") {
      const response: TelegramVerifyResponse = { status: "password_required" };
      return reply.send(response);
    }

    await issueSessionCookie(
      container.authSessions,
      request,
      reply,
      result.user.id,
      container.config.cookieSecure,
    );
    const response: TelegramVerifyResponse = { status: "ok", user: toUserDTO(result.user) };
    return reply.send(response);
  });

  // ── Two-factor password step ─────────────────────────────────────────────
  app.post("/api/auth/telegram/password", async (request, reply) => {
    limiter(request.ip);
    const body = requireBody(request);
    const phone = requireString(body, "phone");
    const password = requireString(body, "password");
    if (password.length < 1) {
      throw new ValidationError("Please provide the two-factor password");
    }

    const result = await container.connection.verifyPassword(phone, password);
    if (result.status !== "ok") {
      // Defensive: password verification always terminates the flow.
      throw new ValidationError("Sign-in incomplete");
    }

    await issueSessionCookie(
      container.authSessions,
      request,
      reply,
      result.user.id,
      container.config.cookieSecure,
    );
    return reply.send({ status: "ok", user: toUserDTO(result.user) });
  });

  // ── Current session (public: returns nulls when signed out) ──────────────
  app.get("/api/auth/me", async (request) => {
    const user = await currentUser(container.repos, container.authSessions, request.cookies);
    if (!user) return { user: null, storage: null, health: null };

    const storage = await container.repos.storages.findByUserAndProvider(user.id, "telegram");
    if (!storage) return { user: toUserDTO(user), storage: null, health: null };

    // A light status read (no Telegram round-trip) keeps /me fast.
    const status = await container.storageHealth.health(user.id, false);
    return {
      user: toUserDTO(user),
      storage: toStorageDTO(storage),
      health: toStorageHealthDTO({
        provider: "telegram",
        state: status.state,
        healthy: status.healthy,
        latencyMs: status.latencyMs,
        message: status.message,
        targetTitle: status.targetTitle,
      }),
    };
  });

  // ── Sign out everywhere: revokes every browser session for this account ──
  app.post("/api/auth/logout-all", async (request, reply) => {
    const user = await currentUser(container.repos, container.authSessions, request.cookies);
    if (!user)
      return reply.status(401).send({ error: { code: "AUTH_REQUIRED", message: "Sign in first" } });
    const revoked = await container.authSessions.revokeAll(user.id);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true, revoked };
  });

  // ── Logout ────────────────────────────────────────────────────────────────
  app.post("/api/auth/logout", async (request, reply) => {
    const user = await currentUser(container.repos, container.authSessions, request.cookies);
    await container.authSessions.revoke(request.cookies[SESSION_COOKIE]);
    if (user) await container.storageHealth.disconnect(user.id);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });
}
