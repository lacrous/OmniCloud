import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateOpaqueName } from "@omnicloud/shared";
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

const encryptionFields = (format: string) => ({
  encryptionFormat: format,
  wrappedKey: "A".repeat(96),
  metadataBlob: "B".repeat(88),
  keyEpoch: "0",
});

function upload(name: string, fields: Record<string, string>) {
  const body = multipartBody(fields, { name, data: Buffer.from("ciphertext") });
  return h.app.inject({
    method: "POST",
    url: "/api/files",
    headers: { "content-type": body.contentType },
    payload: body.payload,
    cookies: { omnicloud_session: cookie },
  });
}

describe("the encryption format of an upload", () => {
  it("accepts OCE2 under an opaque name", async () => {
    const name = generateOpaqueName();
    const response = await upload(name, encryptionFields("OCE2"));
    expect(response.statusCode).toBe(201);
    expect(response.json().file.encryptionFormat).toBe("OCE2");
    expect(response.json().file.name).toBe(name);
  });

  it("still accepts OCE1 under a real name", async () => {
    const response = await upload("report.pdf", encryptionFields("OCE1"));
    expect(response.statusCode).toBe(201);
    expect(response.json().file.encryptionFormat).toBe("OCE1");
  });

  it("rejects an unknown format", async () => {
    const response = await upload("report.pdf", encryptionFields("OCE9"));
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/encryptionFormat/);
  });

  it("rejects OCE2 under a real name, so the format cannot be claimed while leaking it", async () => {
    const response = await upload("tax-return-2026.pdf", encryptionFields("OCE2"));
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/opaque name/i);
  });

  it("still accepts a plaintext upload with no encryption fields", async () => {
    const response = await upload("plain.txt", {});
    expect(response.statusCode).toBe(201);
    expect(response.json().file.encryptionFormat).toBeNull();
  });
});
