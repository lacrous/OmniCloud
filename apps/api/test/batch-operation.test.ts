import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, multipartBody, type TestHarness } from "./harness";

let h: TestHarness;
let cookie: string;
let fileId: string;

beforeAll(async () => {
  h = await createTestHarness();
  cookie = await h.login("+15550000300");
  const body = multipartBody({}, { name: "batch.txt", data: Buffer.from("b") });
  const up = await h.app.inject({
    method: "POST",
    url: "/api/files",
    headers: { "content-type": body.contentType },
    payload: body.payload,
    cookies: { omnicloud_session: cookie },
  });
  fileId = up.json().file.id;
});
afterAll(async () => {
  await h.app.close();
});

const batch = (payload: Record<string, unknown>) =>
  h.app.inject({
    method: "POST",
    url: "/api/files/batch",
    payload,
    cookies: { omnicloud_session: cookie },
  });

describe("batch operations over HTTP", () => {
  it("echoes a valid operationId in the response", async () => {
    const res = await batch({ operation: "star", ids: [fileId], operationId: "batch_http_0001" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ operationId: "batch_http_0001", succeeded: 1 });
  });

  it("omits operationId when the caller did not send one", async () => {
    const res = await batch({ operation: "star", ids: [fileId] });
    expect(res.json().operationId).toBeUndefined();
  });

  it("rejects a malformed operationId", async () => {
    const res = await batch({ operation: "star", ids: [fileId], operationId: "../bad id" });
    expect(res.statusCode).toBe(400);
  });
});
