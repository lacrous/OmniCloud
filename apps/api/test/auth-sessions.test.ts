import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "./harness";

let h: TestHarness;

beforeAll(async () => {
  h = await createTestHarness();
});
afterAll(async () => {
  await h.app.close();
});

const get = (url: string, cookie: string) =>
  h.app.inject({ method: "GET", url, cookies: { omnicloud_session: cookie } });
const post = (url: string, cookie: string) =>
  h.app.inject({ method: "POST", url, payload: {}, cookies: { omnicloud_session: cookie } });

describe("server-side browser sessions", () => {
  it("stores a session row whose token hash is not the cookie value", async () => {
    const cookie = await h.login("+15550000001");
    const row = h.repos._browserSessions.find(
      (s) => s.userId !== undefined && s.revokedAt === null,
    );
    expect(row).toBeDefined();
    expect(row!.tokenHash).not.toBe(cookie);
    expect(JSON.stringify(h.repos._browserSessions)).not.toContain(cookie);
  });

  it("accepts a live session", async () => {
    const cookie = await h.login("+15550000002");
    expect((await get("/api/auth/me", cookie)).json().user).not.toBeNull();
    expect((await get("/api/files", cookie)).statusCode).toBe(200);
  });

  it("rejects a copied cookie after logout", async () => {
    const cookie = await h.login("+15550000003");
    expect((await get("/api/files", cookie)).statusCode).toBe(200);

    const out = await post("/api/auth/logout", cookie);
    expect(out.statusCode).toBe(200);

    expect((await get("/api/files", cookie)).statusCode).toBe(401);
    expect((await get("/api/auth/me", cookie)).json().user).toBeNull();
  });

  it("rejects an unknown token outright", async () => {
    expect((await get("/api/files", "forged-token-that-was-never-issued")).statusCode).toBe(401);
  });

  it("signing out in one place does not sign out another session", async () => {
    const first = await h.login("+15550000004");
    const second = await h.login("+15550000004");
    await post("/api/auth/logout", first);
    expect((await get("/api/files", first)).statusCode).toBe(401);
    expect((await get("/api/files", second)).statusCode).toBe(200);
  });

  it("refuses a session whose row has been revoked directly", async () => {
    const cookie = await h.login("+15550000005");
    for (const row of h.repos._browserSessions) {
      if (row.revokedAt === null) row.revokedAt = new Date();
    }
    expect((await get("/api/files", cookie)).statusCode).toBe(401);
  });

  it("refuses an expired session", async () => {
    const cookie = await h.login("+15550000006");
    for (const row of h.repos._browserSessions) {
      if (row.revokedAt === null) row.expiresAt = new Date(Date.now() - 1000);
    }
    expect((await get("/api/files", cookie)).statusCode).toBe(401);
  });
});

describe("sign out everywhere", () => {
  it("revokes every session for the account, and leaves other accounts alone", async () => {
    const phone = "+15550000100";
    const laptop = await h.login(phone);
    const phoneDevice = await h.login(phone);
    const other = await h.login("+15550000101");

    const out = await h.app.inject({
      method: "POST",
      url: "/api/auth/logout-all",
      payload: {},
      cookies: { omnicloud_session: laptop },
    });
    expect(out.statusCode).toBe(200);
    expect(out.json().revoked).toBeGreaterThanOrEqual(2);

    expect((await get("/api/files", laptop)).statusCode).toBe(401);
    expect((await get("/api/files", phoneDevice)).statusCode).toBe(401);
    expect((await get("/api/files", other)).statusCode).toBe(200);
  });

  it("requires a signed-in session", async () => {
    const out = await h.app.inject({ method: "POST", url: "/api/auth/logout-all", payload: {} });
    expect(out.statusCode).toBe(401);
  });
});
