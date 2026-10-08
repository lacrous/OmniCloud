import { randomUUID } from "node:crypto";
import { REQUEST_ID_HEADER } from "@omnicloud/shared";

export interface HttpRequestLike {
  id: string;
  headers: Record<string, string | string[] | undefined>;
  log: { warn(data: unknown, message?: string): void };
}

export interface HttpReplyLike {
  header(name: string, value: string): unknown;
}

/**
 * Derives the request id from the inbound x-request-id header (so callers can
 * correlate their own traces) or generates one. Used as Fastify's genReqId, so
 * logs and error bodies share the same id.
 */
export function resolveRequestId(headers: Record<string, string | string[] | undefined>): string {
  const inbound = headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
  return typeof candidate === "string" && candidate.length > 0 && candidate.length <= 128
    ? candidate
    : randomUUID();
}

/** Echoes the request id back on the response. */
export function attachRequestId(request: HttpRequestLike, reply: HttpReplyLike): string {
  reply.header(REQUEST_ID_HEADER, request.id);
  return request.id;
}

/**
 * Baseline security headers. The API is JSON/binary only and is never framed,
 * so a strict, dependency-free policy is appropriate. CSP is intentionally
 * omitted here — the SPA (served separately) sets its own.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  "X-Permitted-Cross-Domain-Policies": "none",
};

export function applySecurityHeaders(reply: HttpReplyLike): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    reply.header(name, value);
  }
}

/**
 * Origin allowlist for state-changing requests. With SameSite=Lax cookies and
 * same-origin deployments this is defense-in-depth against CSRF.
 */
export function isAllowedOrigin(
  origin: string | undefined,
  host: string | undefined,
  allowed: string[],
): boolean {
  if (!origin) return true; // non-browser clients (curl, SDK) send no Origin
  if (allowed.length > 0) return allowed.includes(origin);
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
