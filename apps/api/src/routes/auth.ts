import type { FastifyInstance } from "fastify";
import { ForbiddenError, ValidationError } from "@omnicloud/core";
import { SESSION_COOKIE } from "@omnicloud/shared";
import type { Container } from "../container";
import { currentUser, currentUserWithToken, issueSessionCookie } from "../auth";
import { isAllowedOrigin } from "../http";
import { createRateLimiter } from "../rate-limit";
import { parseRecoveryBlob, requireBody, requireString } from "../validation";
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
  // The status route is a read-only poll the UI repeats every few seconds, so it
  // needs its own, larger budget rather than the sign-in limiter's ten per minute.
  const statusLimiter = createRateLimiter({ windowMs: 60_000, max: 120 });

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

  // ── QR sign-in: the phone approves a token shown as a QR code ────────────
  app.post("/api/auth/telegram/qr/start", async (request, reply) => {
    limiter(request.ip);
    const started = await container.connection.startQrLogin();
    return reply.send({ flowId: started.flowId, token: started.token });
  });

  app.get("/api/auth/telegram/qr/status", async (request, reply) => {
    // This route can issue a session cookie once the phone approves, so a
    // cross-origin page must not be able to trigger it. Browsers send Origin on
    // cross-origin requests; a request without one is a non-browser client and is
    // checked against the same allow-list the CSRF hook uses.
    if (
      !isAllowedOrigin(
        request.headers.origin,
        request.headers.host,
        container.config.allowedOrigins,
      )
    ) {
      throw new ForbiddenError("Cross-origin request rejected");
    }
    statusLimiter(request.ip);
    const flowId = requireString(request.query, "flowId");
    const result = await container.connection.pollQrLogin(flowId);
    if (result.status === "approved") {
      await issueSessionCookie(
        container.authSessions,
        request,
        reply,
        result.user.id,
        container.config.cookieSecure,
      );
      return reply.send({ status: "ok", user: toUserDTO(result.user) });
    }
    return reply.send(result);
  });

  app.post("/api/auth/telegram/qr/password", async (request, reply) => {
    limiter(request.ip);
    const body = requireBody(request);
    const flowId = requireString(body, "flowId");
    const password = requireString(body, "password");
    const result = await container.connection.submitQrPassword(flowId, password);
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

  // ── OCE1 recovery blob (opaque ciphertext; the code never reaches the
  // server, so these endpoints only store/retrieve ciphertext for the owner).
  const recoveryLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });

  app.get("/api/auth/recovery", async (request, reply) => {
    const user = await currentUserWithToken(
      container.repos,
      container.authSessions,
      container.apiTokens,
      request.headers,
      request.cookies,
    );
    if (!user)
      return reply.status(401).send({ error: { code: "AUTH_REQUIRED", message: "Sign in first" } });
    const recoveryBlob = await container.repos.users.getRecoveryBlob(user.id);
    return { recoveryBlob };
  });

  app.put("/api/auth/recovery", async (request, reply) => {
    recoveryLimiter(request.ip);
    const user = await currentUserWithToken(
      container.repos,
      container.authSessions,
      container.apiTokens,
      request.headers,
      request.cookies,
    );
    if (!user)
      return reply.status(401).send({ error: { code: "AUTH_REQUIRED", message: "Sign in first" } });
    const recoveryBlob = parseRecoveryBlob(request);
    await container.repos.users.setRecoveryBlob(user.id, recoveryBlob);
    return { status: "ok" };
  });

  app.delete("/api/auth/recovery", async (request, reply) => {
    recoveryLimiter(request.ip);
    const user = await currentUserWithToken(
      container.repos,
      container.authSessions,
      container.apiTokens,
      request.headers,
      request.cookies,
    );
    if (!user)
      return reply.status(401).send({ error: { code: "AUTH_REQUIRED", message: "Sign in first" } });
    await container.repos.users.setRecoveryBlob(user.id, null);
    return { status: "ok" };
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
