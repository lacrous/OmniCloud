import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, multipartBody, type TestHarness } from "./harness";

let h: TestHarness;
let cookie: string;

beforeAll(async () => {
  h = await createTestHarness();
  cookie = await h.login("+15550000200");
});
afterAll(async () => {
  await h.app.close();
});

async function uploadWithKey(key: string | undefined, name = "retry.txt") {
  const body = multipartBody({}, { name, data: Buffer.from("retry payload") });
  return h.app.inject({
    method: "POST",
    url: "/api/files",
    headers: {
      "content-type": body.contentType,
      ...(key ? { "idempotency-key": key } : {}),
    },
    payload: body.payload,
    cookies: { omnicloud_session: cookie },
  });
}

describe("upload idempotency over HTTP", () => {
  it("a retried request with the same Idempotency-Key returns the same file", async () => {
    const key = "retry_key_0001";
    const first = await uploadWithKey(key);
    const second = await uploadWithKey(key);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().file.id).toBe(first.json().file.id);
  });

  it("the retry does not create a second Telegram object or a second file", async () => {
    const key = "retry_key_0002";
    const objectsBefore = h.provider.objects.size;
    const filesBefore = h.repos._files.length;

    await uploadWithKey(key, "once.txt");
    await uploadWithKey(key, "once.txt");

    expect(h.provider.objects.size).toBe(objectsBefore + 1);
    expect(h.repos._files.length).toBe(filesBefore + 1);
  });

  it("uploads without a key behave as before: each request creates a file", async () => {
    const before = h.repos._files.length;
    await uploadWithKey(undefined, "a.txt");
    await uploadWithKey(undefined, "a.txt");
    expect(h.repos._files.length).toBe(before + 2);
  });

  it("rejects a malformed key rather than storing it", async () => {
    const response = await uploadWithKey("bad key!", "bad.txt");
    expect(response.statusCode).toBe(400);
  });
});
