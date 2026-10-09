import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "./harness";
import { StorageEngine } from "@omnicloud/core";
import { FakeStorageProvider } from "./repos";

let h: TestHarness;
let cookie: string;
let otherCookie: string;
let otherProvider: FakeStorageProvider;

beforeAll(async () => {
  // Production gives each account its own channel. Model that: the second account
  // gets a separate provider, so its scan cannot see the first account's objects.
  const primary = new FakeStorageProvider();
  otherProvider = new FakeStorageProvider();
  let otherUserId: string | null = null;
  h = await createTestHarness(undefined, primary, null, undefined, async (userId) =>
    otherUserId !== null && userId === otherUserId
      ? new StorageEngine(otherProvider)
      : new StorageEngine(primary),
  );
  cookie = await h.login("+15550000700");
  otherCookie = await h.login("+15550000701");
  const me = await h.app.inject({
    method: "GET",
    url: "/api/auth/me",
    cookies: { omnicloud_session: otherCookie },
  });
  otherUserId = me.json().user.id;
});
afterAll(async () => {
  await h.app.close();
});

const post = (url: string, payload: Record<string, unknown>, who = cookie) =>
  h.app.inject({ method: "POST", url, payload, cookies: { omnicloud_session: who } });

describe("reconciliation repair over HTTP", () => {
  it("the plan lists an orphaned object and changes nothing", async () => {
    const orphan = await h.provider.put({
      name: "orphan.bin",
      mimeType: "x",
      data: Buffer.from("orph"),
    });
    const before = h.provider.objects.size;

    const res = await post("/api/storage/reconciliation/plan", {});
    expect(res.statusCode).toBe(200);
    expect(res.json().plan.actions.map((a: { id: string }) => a.id)).toContain(
      `adopt-${orphan.messageId}`,
    );
    expect(res.json().plan.deletions).toEqual([]);
    expect(h.provider.objects.size).toBe(before);
  });

  it("apply adopts only the named repair and deletes nothing at the provider", async () => {
    const orphan = await h.provider.put({
      name: "adopt.bin",
      mimeType: "x",
      data: Buffer.from("adoptme"),
    });
    const before = h.provider.objects.size;

    const res = await post("/api/storage/reconciliation/apply", {
      approvedIds: [`adopt-${orphan.messageId}`],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.applied.map((a: { id: string }) => a.id)).toEqual([
      `adopt-${orphan.messageId}`,
    ]);
    expect(h.provider.objects.size).toBe(before);
  });

  it("refuses a repair id the plan did not offer", async () => {
    const res = await post("/api/storage/reconciliation/apply", {
      approvedIds: ["delete-everything"],
    });
    expect(res.statusCode).toBe(400);
  });

  it("an empty approval applies nothing", async () => {
    const res = await post("/api/storage/reconciliation/apply", { approvedIds: [] });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.applied).toEqual([]);
  });

  it("another user cannot apply a repair to an object in this user's channel", async () => {
    const orphan = await h.provider.put({
      name: "mine.bin",
      mimeType: "x",
      data: Buffer.from("mine"),
    });
    void otherProvider;
    // The other account's scan covers only its own channel, so the id is not offered to it.
    const res = await post(
      "/api/storage/reconciliation/apply",
      { approvedIds: [`adopt-${orphan.messageId}`] },
      otherCookie,
    );
    // The id is not in the other account's plan, so the request is refused as not offered.
    expect(res.statusCode).toBe(400);
    expect(h.repos._files.some((f) => f.name === "mine.bin")).toBe(false);
  });
});
