import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, multipartBody, type TestHarness } from "./harness";

let h: TestHarness;
let cookie: string;

beforeAll(async () => {
  h = await createTestHarness();
  cookie = await h.login("+15550000300");
});
afterAll(async () => {
  await h.app.close();
});

const encryptionFields = {
  encryptionFormat: "OCE1",
  wrappedKey: "A".repeat(96),
  metadataBlob: "B".repeat(88),
  keyEpoch: "0",
};

async function upload(
  fields: Record<string, string>,
  name = "secret.bin",
  data: Buffer = Buffer.from("ciphertext"),
) {
  const body = multipartBody(fields, { name, data });
  return h.app.inject({
    method: "POST",
    url: "/api/files",
    headers: { "content-type": body.contentType },
    payload: body.payload,
    cookies: { omnicloud_session: cookie },
  });
}

async function replace(
  id: string,
  fields: Record<string, string>,
  data: Buffer = Buffer.from("next ciphertext"),
) {
  const body = multipartBody(fields, { name: "secret.bin", data });
  return h.app.inject({
    method: "POST",
    url: `/api/files/${id}/replace`,
    headers: { "content-type": body.contentType },
    payload: body.payload,
    cookies: { omnicloud_session: cookie },
  });
}

function expectEncryption(dto: Record<string, unknown>, fields: Record<string, string>) {
  expect(dto.encryptionFormat).toBe(fields.encryptionFormat);
  expect(dto.wrappedKey).toBe(fields.wrappedKey);
  expect(dto.metadataBlob).toBe(fields.metadataBlob);
  expect(dto.keyEpoch).toBe(Number(fields.keyEpoch));
}

function expectPlaintext(dto: Record<string, unknown>) {
  expect(dto.encryptionFormat).toBeNull();
  expect(dto.wrappedKey).toBeNull();
  expect(dto.metadataBlob).toBeNull();
  expect(dto.keyEpoch).toBeNull();
}

describe("encrypted upload metadata over HTTP", () => {
  it("roundtrips the four OCE1 fields through the multipart upload into the DTO", async () => {
    const response = await upload(encryptionFields);
    expect(response.statusCode).toBe(201);
    expectEncryption(response.json().file, encryptionFields);
  });

  it("surfaces the fields on GET metadata and on the current version DTO", async () => {
    const uploaded = await upload(encryptionFields, "roundtrip.bin");
    const id = uploaded.json().file.id as string;

    const meta = await h.app.inject({
      method: "GET",
      url: `/api/files/${id}`,
      cookies: { omnicloud_session: cookie },
    });
    expect(meta.statusCode).toBe(200);
    expectEncryption(meta.json().file, encryptionFields);

    const versions = await h.app.inject({
      method: "GET",
      url: `/api/files/${id}/versions`,
      cookies: { omnicloud_session: cookie },
    });
    expect(versions.statusCode).toBe(200);
    const list = versions.json().versions as Record<string, unknown>[];
    expect(list).toHaveLength(1);
    expectEncryption(list[0]!, encryptionFields);
    expect(list[0]!.isCurrent).toBe(true);
  });

  it("leaves the fields null for a plaintext upload", async () => {
    const response = await upload({}, "plain.txt", Buffer.from("plaintext"));
    expect(response.statusCode).toBe(201);
    expectPlaintext(response.json().file);
  });

  it("accepts the top of the uint32 epoch range", async () => {
    const response = await upload({ ...encryptionFields, keyEpoch: "4294967295" });
    expect(response.statusCode).toBe(201);
    expect(response.json().file.keyEpoch).toBe(4294967295);
  });
});

describe("replace updates and clears encryption metadata", () => {
  it("replacing with encryption updates the file-level fields", async () => {
    const uploaded = await upload({}, "replace-me.bin", Buffer.from("one"));
    const id = uploaded.json().file.id as string;

    const next = {
      encryptionFormat: "OCE1",
      wrappedKey: "C".repeat(96),
      metadataBlob: "D".repeat(120),
      keyEpoch: "1",
    };
    const response = await replace(id, next);
    expect(response.statusCode).toBe(200);
    expectEncryption(response.json().file, next);

    const versions = await h.app.inject({
      method: "GET",
      url: `/api/files/${id}/versions`,
      cookies: { omnicloud_session: cookie },
    });
    const list = versions.json().versions as Record<string, unknown>[];
    expect(list).toHaveLength(2);
    expectEncryption(list[0]!, next);
    expectPlaintext(list[1]!);
  });

  it("replacing without encryption clears the file-level fields", async () => {
    const uploaded = await upload(encryptionFields, "clear-me.bin");
    const id = uploaded.json().file.id as string;

    const response = await replace(id, {}, Buffer.from("now plaintext"));
    expect(response.statusCode).toBe(200);
    expectPlaintext(response.json().file);

    const versions = await h.app.inject({
      method: "GET",
      url: `/api/files/${id}/versions`,
      cookies: { omnicloud_session: cookie },
    });
    const list = versions.json().versions as Record<string, unknown>[];
    expect(list).toHaveLength(2);
    // The new version is plaintext; the old encrypted version keeps its fields.
    expectPlaintext(list[0]!);
    expectEncryption(list[1]!, encryptionFields);
  });
});

describe("invalid encryption metadata is refused", () => {
  async function expectRejected(fields: Record<string, string>) {
    const response = await upload(fields, "bad.bin");
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_REQUEST");
  }

  it("rejects a format identifier other than OCE1", async () => {
    await expectRejected({ ...encryptionFields, encryptionFormat: "OCE2" });
  });

  it("rejects encryption fields without an encryptionFormat", async () => {
    const { encryptionFormat: _omitted, ...rest } = encryptionFields;
    await expectRejected(rest);
  });

  it("rejects a wrappedKey that is too short or too long", async () => {
    await expectRejected({ ...encryptionFields, wrappedKey: "A".repeat(55) });
    await expectRejected({ ...encryptionFields, wrappedKey: "A".repeat(4097) });
  });

  it("rejects a wrappedKey outside the base64 alphabet", async () => {
    await expectRejected({ ...encryptionFields, wrappedKey: "!".repeat(96) });
  });

  it("rejects a metadataBlob that is too short or outside the base64 alphabet", async () => {
    await expectRejected({ ...encryptionFields, metadataBlob: "B".repeat(55) });
    await expectRejected({ ...encryptionFields, metadataBlob: "@".repeat(88) });
  });

  it("rejects a missing or malformed keyEpoch", async () => {
    const { keyEpoch: _omitted, ...rest } = encryptionFields;
    await expectRejected(rest);
    await expectRejected({ ...encryptionFields, keyEpoch: "abc" });
    await expectRejected({ ...encryptionFields, keyEpoch: "-1" });
    await expectRejected({ ...encryptionFields, keyEpoch: "1.5" });
  });

  it("rejects a keyEpoch above the uint32 range", async () => {
    await expectRejected({ ...encryptionFields, keyEpoch: "4294967296" });
  });

  it("rejects invalid encryption on replace before anything is committed", async () => {
    const uploaded = await upload({}, "guard.bin", Buffer.from("original"));
    const id = uploaded.json().file.id as string;
    const versionsBefore = (
      await h.app.inject({
        method: "GET",
        url: `/api/files/${id}/versions`,
        cookies: { omnicloud_session: cookie },
      })
    ).json().versions as unknown[];

    const body = multipartBody(
      { ...encryptionFields, encryptionFormat: "plaintext?" },
      { name: "secret.bin", data: Buffer.from("nope") },
    );
    const response = await h.app.inject({
      method: "POST",
      url: `/api/files/${id}/replace`,
      headers: { "content-type": body.contentType },
      payload: body.payload,
      cookies: { omnicloud_session: cookie },
    });
    expect(response.statusCode).toBe(400);

    const versionsAfter = (
      await h.app.inject({
        method: "GET",
        url: `/api/files/${id}/versions`,
        cookies: { omnicloud_session: cookie },
      })
    ).json().versions as unknown[];
    expect(versionsAfter).toHaveLength(versionsBefore.length);
  });
});
