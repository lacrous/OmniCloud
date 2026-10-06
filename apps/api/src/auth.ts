import type { FastifyInstance } from "fastify";
import { UnauthorizedError, type Repos } from "@omnicloud/core";
import { SESSION_COOKIE } from "@omnicloud/shared";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string };
    user: { id: string };
  }
}

const AUTH_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

/**
 * Session middleware: every /api route requires a signed session cookie
 * (except /api/auth/*). The Telegram session itself never leaves the server.
 */
export function registerAuthHook(app: FastifyInstance, repos: Repos): void {
  app.addHook("preHandler", async (request) => {
    const url = request.routeOptions?.url ?? "";
    // Only /api routes require a session (and /api/auth/* is public).
    // Everything else (static files, SPA fallback, unknown paths) passes
    // through so the not-found/static handlers can do their job.
    if (!url.startsWith("/api/") || url.startsWith("/api/auth/")) return;

    const token = request.cookies[SESSION_COOKIE];
    if (!token) throw new UnauthorizedError();

    let payload: { sub: string };
    try {
      payload = app.jwt.verify<{ sub: string }>(token);
    } catch {
      throw new UnauthorizedError("Session expired — please sign in again");
    }

    const user = await repos.users.findById(payload.sub);
    if (!user) throw new UnauthorizedError("Account no longer exists");
    request.user = { id: user.id };
  });
}

/** Issues the browser session cookie after a successful login. */
export function issueSessionCookie(
  app: FastifyInstance,
  reply: { setCookie(name: string, value: string, options: object): unknown },
  userId: string,
  cookieSecure: boolean,
): void {
  const token = app.jwt.sign({ sub: userId }, { expiresIn: "30d" });
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure,
    path: "/",
    maxAge: AUTH_TTL_SECONDS,
  });
}

/** Resolves the signed-in user for the (public) /api/auth/me endpoint. */
export async function currentUser(
  app: FastifyInstance,
  repos: Repos,
  cookieHeader: Record<string, string | undefined>,
) {
  const token = cookieHeader[SESSION_COOKIE];
  if (!token) return null;
  try {
    const payload = app.jwt.verify<{ sub: string }>(token);
    return await repos.users.findById(payload.sub);
  } catch {
    return null;
  }
}
