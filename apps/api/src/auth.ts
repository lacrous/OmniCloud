import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  AuthInvalidError,
  DEFAULT_SESSION_TTL_DAYS,
  UnauthorizedError,
  type AuthSessionService,
  type Repos,
} from "@omnicloud/core";
import { SESSION_COOKIE } from "@omnicloud/shared";

declare module "fastify" {
  interface FastifyRequest {
    user: { id: string };
    authSessionId?: string;
  }
}

/**
 * Session middleware: every /api route requires a live browser session (except
 * /api/auth/* and the public health probes). The cookie is an opaque token that
 * is looked up server-side on every request, so logout and "sign out
 * everywhere" take effect on the next request, not at token expiry.
 */
export function registerAuthHook(
  app: FastifyInstance,
  repos: Repos,
  authSessions: AuthSessionService,
): void {
  app.addHook("preHandler", async (request) => {
    const url = request.routeOptions?.url ?? "";
    if (!url.startsWith("/api/") || url.startsWith("/api/auth/") || url.startsWith("/api/health")) {
      return;
    }

    const session = await authSessions.resolve(request.cookies[SESSION_COOKIE]);
    if (!session) throw new UnauthorizedError();

    const user = await repos.users.findById(session.userId);
    if (!user) throw new AuthInvalidError("Account no longer exists");
    request.user = { id: user.id };
    request.authSessionId = session.id;
  });
}

/** Starts a browser session for a user and sets its HttpOnly cookie. */
export async function issueSessionCookie(
  authSessions: AuthSessionService,
  request: FastifyRequest,
  reply: { setCookie(name: string, value: string, options: object): unknown },
  userId: string,
  cookieSecure: boolean,
): Promise<void> {
  const { token } = await authSessions.issue(userId, {
    userAgent: request.headers["user-agent"] ?? null,
    ip: request.ip,
  });
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure,
    path: "/",
    maxAge: DEFAULT_SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

/** Resolves the signed-in user for the public /api/auth/me endpoint. */
export async function currentUser(
  repos: Repos,
  authSessions: AuthSessionService,
  cookies: Record<string, string | undefined>,
) {
  const session = await authSessions.resolve(cookies[SESSION_COOKIE]);
  if (!session) return null;
  return repos.users.findById(session.userId);
}
