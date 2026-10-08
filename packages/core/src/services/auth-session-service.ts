import { createHash, randomBytes } from "node:crypto";
import type { BrowserSessionRecord, BrowserSessionRepository } from "../repos";
import { UnauthorizedError } from "../errors";

/**
 * Browser sessions: opaque random tokens held in an HttpOnly cookie. The
 * server stores only a SHA-256 of each token, so a database read does not give
 * an attacker usable session cookies, and logout takes effect immediately
 * because every request is checked against the stored, revocable record.
 */

export interface IssuedSession {
  /** The raw token. Set it in the cookie and never store or log it. */
  token: string;
  session: BrowserSessionRecord;
}

export interface SessionServiceOptions {
  /** Lifetime of a session from issue, in days. */
  ttlDays?: number;
  now?: () => Date;
}

export const DEFAULT_SESSION_TTL_DAYS = 30;

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export class AuthSessionService {
  private readonly ttlMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly repo: BrowserSessionRepository,
    options: SessionServiceOptions = {},
  ) {
    this.ttlMs = (options.ttlDays ?? DEFAULT_SESSION_TTL_DAYS) * 24 * 60 * 60 * 1000;
    this.now = options.now ?? (() => new Date());
  }

  async issue(
    userId: string,
    context: { userAgent?: string | null; ip?: string | null } = {},
  ): Promise<IssuedSession> {
    const token = randomBytes(32).toString("base64url");
    const session = await this.repo.create({
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(this.now().getTime() + this.ttlMs),
      userAgent: truncate(context.userAgent ?? null, 256),
      ip: context.ip ?? null,
    });
    return { token, session };
  }

  /**
   * Resolves a raw token to its active session. Returns null for an unknown,
   * expired, or revoked token. Successful lookups refresh `lastUsedAt`.
   */
  async resolve(token: string | undefined): Promise<BrowserSessionRecord | null> {
    if (!token || token.length < 16 || token.length > 128) return null;
    const session = await this.repo.findByTokenHash(hashToken(token));
    if (!session) return null;
    const now = this.now();
    if (session.revokedAt !== null || session.expiresAt.getTime() <= now.getTime()) {
      return null;
    }
    await this.repo.touch(session.id, now);
    return session;
  }

  /** Revokes the session behind a token. Unknown tokens are a no-op. */
  async revoke(token: string | undefined): Promise<void> {
    if (!token) return;
    const session = await this.repo.findByTokenHash(hashToken(token));
    if (session && session.revokedAt === null) {
      await this.repo.revoke(session.id, this.now());
    }
  }

  /** Revokes every session for a user, for "sign out everywhere". */
  async revokeAll(userId: string): Promise<number> {
    return this.repo.revokeAllForUser(userId, this.now());
  }

  listActive(userId: string): Promise<BrowserSessionRecord[]> {
    return this.repo.listActiveForUser(userId, this.now());
  }

  /** Housekeeping: removes sessions that expired more than `graceDays` ago. */
  async pruneExpired(graceDays = 7): Promise<number> {
    const cutoff = new Date(this.now().getTime() - graceDays * 24 * 60 * 60 * 1000);
    return this.repo.deleteExpiredBefore(cutoff);
  }
}

function truncate(value: string | null, max: number): string | null {
  return value === null ? null : value.slice(0, max);
}

export function requireSession(session: BrowserSessionRecord | null): BrowserSessionRecord {
  if (!session) throw new UnauthorizedError();
  return session;
}
