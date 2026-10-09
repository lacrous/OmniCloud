import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, multipartBody, type TestHarness } from "./harness";

let h: TestHarness;
let cookie: string;

beforeAll(async () => {
  h = await createTestHarness();
  cookie = await h.login();
});

afterAll(async () => {
  await h?.container.shutdown();
});

async function uploadFile(name: string, text: string, replaceFileId?: string): Promise<string> {
  const fields: Record<string, string> = replaceFileId ? { replaceFileId } : {};
  const body = multipartBody(fields, { name, data: Buffer.from(text) });
  const response = await h.app.inject({
    method: replaceFileId ? "POST" : "POST",
    url: replaceFileId ? `/api/files/${replaceFileId}/replace` : "/api/files",
    headers: { "content-type": body.contentType },
    payload: body.payload,
    cookies: { omnicloud_session: cookie },
  });
  expect(response.statusCode).toBeLessThan(300);
  return response.json().file.id as string;
}

function prune(id: string, payload: Record<string, unknown>, sessionCookie = cookie) {
  return h.app.inject({
    method: "POST",
    url: `/api/files/${id}/versions/prune`,
    payload,
    cookies: { omnicloud_session: sessionCookie },
  });
}

describe("POST /api/files/:id/versions/prune", () => {
  it("requires a signed-in user", async () => {
    const id = await uploadFile("p1.txt", "one");
    const response = await h.app.inject({
      method: "POST",
      url: `/api/files/${id}/versions/prune`,
      payload: { policy: "KEEP_ALL" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("keeps everything under KEEP_ALL", async () => {
    const id = await uploadFile("p2.txt", "one");
    await uploadFile("p2.txt", "two", id);
    const response = await prune(id, { policy: "KEEP_ALL" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ removed: 0 });
  });

  it("prunes old versions under KEEP_LATEST_N and keeps the current one", async () => {
    const id = await uploadFile("p3.txt", "one");
    await uploadFile("p3.txt", "two", id);
    await uploadFile("p3.txt", "three", id);
    const response = await prune(id, { policy: "KEEP_LATEST_N", count: 0 });
    expect(response.json()).toEqual({ removed: 2 });
    const versions = await h.app.inject({
      method: "GET",
      url: `/api/files/${id}/versions`,
      cookies: { omnicloud_session: cookie },
    });
    expect(versions.json().versions).toHaveLength(1);
    const file = await h.app.inject({
      method: "GET",
      url: `/api/files/${id}`,
      cookies: { omnicloud_session: cookie },
    });
    expect(file.statusCode).toBe(200);
  });

  it("rejects an unknown policy rather than pruning", async () => {
    const id = await uploadFile("p4.txt", "one");
    const response = await prune(id, { policy: "DELETE_EVERYTHING" });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_REQUEST");
  });

  it("rejects a negative or fractional count", async () => {
    const id = await uploadFile("p5.txt", "one");
    expect((await prune(id, { policy: "KEEP_LATEST_N", count: -1 })).statusCode).toBe(400);
    expect((await prune(id, { policy: "KEEP_LATEST_N", count: 1.5 })).statusCode).toBe(400);
  });

  it("rejects KEEP_FOR_DAYS with fewer than one day", async () => {
    const id = await uploadFile("p6.txt", "one");
    expect((await prune(id, { policy: "KEEP_FOR_DAYS", days: 0 })).statusCode).toBe(400);
  });

  it("cannot prune another user's file", async () => {
    const id = await uploadFile("p7.txt", "one");
    const other = await h.login("+15557770001");
    const response = await prune(id, { policy: "KEEP_LATEST_N", count: 0 }, other);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).not.toBe(200);
  });
});
