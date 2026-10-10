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

/** Builds the same form the web upload helper sends: file, then operationId. */
function webUpload(operationId: string, text: string) {
  const body = multipartBody({ operationId }, { name: "browser.txt", data: Buffer.from(text) });
  return h.app.inject({
    method: "POST",
    url: "/api/files",
    headers: { "content-type": body.contentType },
    payload: body.payload,
    cookies: { omnicloud_session: cookie },
  });
}

describe("a browser retry of the same upload job", () => {
  it("the retry returns the original file and creates no duplicate", async () => {
    const key = "11111111-2222-4333-8444-555555555555";
    const first = await webUpload(key, "retry me");
    expect(first.statusCode).toBe(201);
    const retry = await webUpload(key, "retry me");
    expect(retry.statusCode).toBeLessThan(300);
    expect(retry.json().file.id).toBe(first.json().file.id);
  });
});

function webUploadNoKey(text: string) {
  const body = multipartBody({}, { name: "browser.txt", data: Buffer.from(text) });
  return h.app.inject({
    method: "POST",
    url: "/api/files",
    headers: { "content-type": body.contentType },
    payload: body.payload,
    cookies: { omnicloud_session: cookie },
  });
}

describe("without the key the same retry creates a second file (the bug)", () => {
  it("demonstrates the duplicate the key prevents", async () => {
    const first = await webUploadNoKey("dup");
    const second = await webUploadNoKey("dup");
    expect(second.json().file.id).not.toBe(first.json().file.id);
  });
});
