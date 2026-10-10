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

function send(url: string, key: string | null, text: string) {
  const body = multipartBody({}, { name: "doc.txt", data: Buffer.from(text) });
  const headers: Record<string, string> = { "content-type": body.contentType };
  if (key) headers["idempotency-key"] = key;
  return h.app.inject({
    method: "POST",
    url,
    headers,
    payload: body.payload,
    cookies: { omnicloud_session: cookie },
  });
}

async function newFile(name: string): Promise<string> {
  const response = await send("/api/files", null, `${name} v1`);
  expect(response.statusCode).toBe(201);
  return response.json().file.id as string;
}

async function versionCount(id: string): Promise<number> {
  const response = await h.app.inject({
    method: "GET",
    url: `/api/files/${id}/versions`,
    cookies: { omnicloud_session: cookie },
  });
  return response.json().versions.length as number;
}

describe("replacing a file with an idempotency key", () => {
  it("a retried replacement with the same key creates one new version, not two", async () => {
    const id = await newFile("replay-a.txt");
    const before = await versionCount(id);

    const first = await send(`/api/files/${id}/replace`, "replace_key_0001", "second");
    expect(first.statusCode).toBeLessThan(300);
    const retry = await send(`/api/files/${id}/replace`, "replace_key_0001", "second");
    expect(retry.statusCode).toBeLessThan(300);

    expect(await versionCount(id)).toBe(before + 1);
  });

  it("the same replacement key with different bytes is refused", async () => {
    const id = await newFile("replay-b.txt");
    const first = await send(`/api/files/${id}/replace`, "replace_key_0002", "first new");
    expect(first.statusCode).toBeLessThan(300);
    const conflicting = await send(`/api/files/${id}/replace`, "replace_key_0002", "different");
    expect(conflicting.statusCode).toBe(409);
  });
});

describe("replacing a file without an idempotency key", () => {
  it("each keyless replacement still creates its own new version", async () => {
    const id = await newFile("keyless.txt");
    const before = await versionCount(id);
    expect((await send(`/api/files/${id}/replace`, null, "one")).statusCode).toBeLessThan(300);
    expect((await send(`/api/files/${id}/replace`, null, "two")).statusCode).toBeLessThan(300);
    expect(await versionCount(id)).toBe(before + 2);
  });
});

describe("replacing with a key already used on another file", () => {
  it("is refused, so one key can never be spent on two different files", async () => {
    const a = await newFile("target-a.txt");
    const b = await newFile("target-b.txt");
    expect(
      (await send(`/api/files/${a}/replace`, "replace_key_0003", "payload")).statusCode,
    ).toBeLessThan(300);
    const elsewhere = await send(`/api/files/${b}/replace`, "replace_key_0003", "payload");
    expect(elsewhere.statusCode).toBe(409);
  });
});
