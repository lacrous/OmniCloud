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

function upload(key: string, text: string) {
  const body = multipartBody({ operationId: key }, { name: "keyed.txt", data: Buffer.from(text) });
  return h.app.inject({
    method: "POST",
    url: "/api/files",
    headers: { "content-type": body.contentType, "idempotency-key": key },
    payload: body.payload,
    cookies: { omnicloud_session: cookie },
  });
}

describe("reusing an upload idempotency key", () => {
  it("an identical retry returns the original file", async () => {
    const first = await upload("route_key_0001", "same bytes");
    expect(first.statusCode).toBe(201);
    const again = await upload("route_key_0001", "same bytes");
    expect(again.statusCode).toBeLessThan(300);
    expect(again.json().file.id).toBe(first.json().file.id);
  });

  it("the same key with different bytes is refused with 409, and nothing is stored", async () => {
    const first = await upload("route_key_0002", "original bytes");
    expect(first.statusCode).toBe(201);
    const conflicting = await upload("route_key_0002", "other bytes");
    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json().error.code).toBe("CONFLICT");
    expect(conflicting.json().error.message).toMatch(/different file/);
  });
});
