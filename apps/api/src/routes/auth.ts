import type { FastifyInstance } from "fastify";
import { ValidationError } from "@omnicloud/core";
import type { Container } from "../container";
import { currentUser, issueSessionCookie } from "../auth";
import { createRateLimiter } from "../rate-limit";
import { requireBody, requireString } from "../validation";
import { toStorageDTO, toUserDTO } from "../mappers";
import type { TelegramVerifyResponse } from "@omnicloud/shared";

const PHONE_PATTERN = /^\+?[0-9]\d{4,14}$/;

/**
 * Telegram connection + browser session endpoints.
 *
 * Flow: POST /telegram/start sends the login code, POST /telegram/verify
 * checks it, POST /telegram/password completes two-factor sign-in.
 * The MTProto session is stored server-side only.
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

    issueSessionCookie(app, reply, result.user.id, container.config.cookieSecure);
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
      return reply
        .status(400)
        .send({ error: { code: "VALIDATION_ERROR", message: "Sign-in incomplete" } });
    }

    issueSessionCookie(app, reply, result.user.id, container.config.cookieSecure);
    return reply.send({ status: "ok", user: toUserDTO(result.user) });
  });

  // ── Current session ──────────────────────────────────────────────────────
  app.get("/api/auth/me", async (request) => {
    const user = await currentUser(app, container.repos, request.cookies);
    if (!user) return { user: null, storage: null };

    const storage = await container.repos.storages.findByUserAndProvider(user.id, "telegram");
    return {
      user: toUserDTO(user),
      storage: storage ? toStorageDTO(storage) : null,
    };
  });

  // ── Logout ────────────────────────────────────────────────────────────────
  app.post("/api/auth/logout", async (request, reply) => {
    reply.clearCookie("omnicloud_session", { path: "/" });
    return { ok: true };
  });
}
