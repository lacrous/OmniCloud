import { beforeEach, describe, expect, it } from "vitest";
import { AuthSessionService, hashToken } from "../src/services/auth-session-service";
import { createInMemoryRepos, makeUser, type InMemoryRepos } from "./fakes";

const DAY = 24 * 60 * 60 * 1000;
let repos: InMemoryRepos;
let clock: Date;
let auth: AuthSessionService;
let userId: string;

beforeEach(() => {
  repos = createInMemoryRepos();
  clock = new Date("2026-10-09T10:00:00Z");
  auth = new AuthSessionService(repos.browserSessions, { now: () => clock });
  userId = makeUser().id;
});

describe("browser sessions", () => {
  it("resolves a freshly issued token", async () => {
    const { token } = await auth.issue(userId);
    expect((await auth.resolve(token))?.userId).toBe(userId);
  });

  it("stores only a hash of the token, never the raw token", async () => {
    const { token, session } = await auth.issue(userId);
    expect(session.tokenHash).toBe(hashToken(token));
    expect(session.tokenHash).not.toBe(token);
    expect(JSON.stringify(repos._browserSessions)).not.toContain(token);
  });

  it("issues unique, unguessable tokens", async () => {
    const a = await auth.issue(userId);
    const b = await auth.issue(userId);
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(40);
  });

  it("refuses an unknown token", async () => {
    await auth.issue(userId);
    expect(await auth.resolve("this-token-was-never-issued-by-us")).toBeNull();
  });

  it("refuses a missing or malformed token", async () => {
    expect(await auth.resolve(undefined)).toBeNull();
    expect(await auth.resolve("short")).toBeNull();
    expect(await auth.resolve("x".repeat(300))).toBeNull();
  });

  it("revokes immediately on logout, so a copied token stops working", async () => {
    const { token } = await auth.issue(userId);
    expect(await auth.resolve(token)).not.toBeNull();

    await auth.revoke(token);

    expect(await auth.resolve(token)).toBeNull();
  });

  it("refuses a session after its expiry", async () => {
    const { token } = await auth.issue(userId);
    clock = new Date(clock.getTime() + 30 * DAY + 1);
    expect(await auth.resolve(token)).toBeNull();
  });

  it("still accepts a session just before its expiry", async () => {
    const { token } = await auth.issue(userId);
    clock = new Date(clock.getTime() + 30 * DAY - 60_000);
    expect(await auth.resolve(token)).not.toBeNull();
  });

  it("revokes every session for a user on sign-out-everywhere", async () => {
    const a = await auth.issue(userId);
    const b = await auth.issue(userId);
    const other = await auth.issue(makeUser("200").id);

    expect(await auth.revokeAll(userId)).toBe(2);

    expect(await auth.resolve(a.token)).toBeNull();
    expect(await auth.resolve(b.token)).toBeNull();
    expect(await auth.resolve(other.token)).not.toBeNull();
  });

  it("revoking an already-revoked or unknown token is harmless", async () => {
    const { token } = await auth.issue(userId);
    await auth.revoke(token);
    await expect(auth.revoke(token)).resolves.toBeUndefined();
    await expect(auth.revoke("never-issued-token-value")).resolves.toBeUndefined();
  });

  it("records last use and truncates an oversized user agent", async () => {
    const { token } = await auth.issue(userId, { userAgent: "x".repeat(900), ip: "10.0.0.1" });
    expect(repos._browserSessions[0]!.userAgent!.length).toBe(256);
    clock = new Date(clock.getTime() + 5_000);
    await auth.resolve(token);
    expect(repos._browserSessions[0]!.lastUsedAt?.getTime()).toBe(clock.getTime());
  });

  it("lists only active sessions", async () => {
    const live = await auth.issue(userId);
    const gone = await auth.issue(userId);
    await auth.revoke(gone.token);
    const active = await auth.listActive(userId);
    expect(active.map((s) => s.id)).toEqual([live.session.id]);
  });

  it("prunes sessions expired beyond the grace period", async () => {
    await auth.issue(userId);
    clock = new Date(clock.getTime() + 40 * DAY);
    expect(await auth.pruneExpired(7)).toBe(1);
    expect(repos._browserSessions).toHaveLength(0);
  });
});
