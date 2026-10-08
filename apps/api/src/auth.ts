import type { FastifyInstance } from "fastify";
import { AuthInvalidError, UnauthorizedError, type Repos } from "@omnicloud/core";
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
 * (except /api/auth/* and the public health probes). The Telegram session
 * itself never leaves the server.
 */
export function registerAuthHook(app: FastifyInstance, repos: Repos): void {
  app.addHook("preHandler", async (request) => {
    const url = request.routeOptions?.url ?? "";
    // Only /api routes require a session; /api/auth/* and /api/health are public.
    // Static files, the SPA fallback and unknown paths pass through.
    if (!url.startsWith("/api/") || url.startsWith("/api/auth/") || url.startsWith("/api/health")) {
      return;
    }

    const token = request.cookies[SESSION_COOKIE];
    if (!token) throw new UnauthorizedError();

    let payload: { sub: string };
    try {
      payload = app.jwt.verify<{ sub: string }>(token);
    } catch {
      throw new AuthInvalidError();
    }

    const user = await repos.users.findById(payload.sub);
    if (!user) throw new AuthInvalidError("Account no longer exists");
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
  cookies: Record<string, string | undefined>,
) {
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  try {
    const payload = app.jwt.verify<{ sub: string }>(token);
    return await repos.users.findById(payload.sub);
  } catch {
    return null;
  }
}
