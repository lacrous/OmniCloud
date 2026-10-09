import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, multipartBody, type TestHarness } from "./harness";

let h: TestHarness;
let cookie: string;

beforeAll(async () => {
  h = await createTestHarness();
  cookie = await h.login("+15550000400");
});
afterAll(async () => {
  await h.app.close();
});

describe("storage reconciliation over HTTP", () => {
  it("reports a stored object that no record references, and leaves it in place", async () => {
    const body = multipartBody({}, { name: "kept.txt", data: Buffer.from("kept") });
    await h.app.inject({
      method: "POST",
      url: "/api/files",
      headers: { "content-type": body.contentType },
      payload: body.payload,
      cookies: { omnicloud_session: cookie },
    });
    const leaked = await h.provider.put({
      name: "leaked.bin",
      mimeType: "x",
      data: Buffer.from("leak"),
    });

    const res = await h.app.inject({
      method: "POST",
      url: "/api/storage/reconciliation",
      payload: {},
      cookies: { omnicloud_session: cookie },
    });

    expect(res.statusCode).toBe(200);
    const unknownIds = res
      .json()
      .report.unknown.map((u: { messageId: number }) => String(u.messageId));
    expect(unknownIds).toContain(leaked.messageId);
    expect(h.provider.objects.has(leaked.messageId)).toBe(true);
  });

  it("requires a signed-in session", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/api/storage/reconciliation",
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });
});
