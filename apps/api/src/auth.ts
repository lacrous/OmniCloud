import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  ApiTokenService,
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
  apiTokens: ApiTokenService,
): void {
  app.addHook("preHandler", async (request) => {
    const url = request.routeOptions?.url ?? "";
    // Public routes: the auth endpoints, the health probes, and the update
    // check. The update check exposes only the running version and the newest
    // published version of an open-source package — no user data.
    if (
      !url.startsWith("/api/") ||
      url.startsWith("/api/auth/") ||
      url.startsWith("/api/health") ||
      url.startsWith("/api/update/")
    ) {
      return;
    }

    const bearer = bearerToken(request.headers.authorization);
    if (bearer !== undefined) {
      const token = await apiTokens.resolve(bearer);
      if (!token) throw new UnauthorizedError();
      const owner = await repos.users.findById(token.userId);
      if (!owner) throw new AuthInvalidError("Account no longer exists");
      request.user = { id: owner.id };
      request.authSessionId = undefined;
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

function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : undefined;
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

/**
 * Like `currentUser`, but also accepts a personal API token (Authorization:
 * Bearer) so non-browser clients (the `omnicloud` CLI) can use cookie-less
 * `/api/auth/*` endpoints such as the recovery-blob routes. A bearer header
 * that does not resolve is rejected outright rather than falling back to the
 * cookie, so a revoked or mistyped token fails loudly.
 */
export async function currentUserWithToken(
  repos: Repos,
  authSessions: AuthSessionService,
  apiTokens: ApiTokenService,
  headers: { authorization?: string | undefined },
  cookies: Record<string, string | undefined>,
) {
  const bearer = bearerToken(headers.authorization);
  if (bearer !== undefined) {
    const token = await apiTokens.resolve(bearer);
    if (!token) return null;
    return repos.users.findById(token.userId);
  }
  return currentUser(repos, authSessions, cookies);
}
