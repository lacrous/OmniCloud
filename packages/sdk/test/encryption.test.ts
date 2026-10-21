import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptFile } from "@omnicloud/crypto";
import type { FileDTO } from "@omnicloud/shared";
import {
  OmniCloudClient,
  OmniCloudError,
  decryptFile,
  downloadEncrypted,
  generateUrk,
  readHeader,
  uploadEncrypted,
} from "../src/index";
import type { FileMetadata } from "../src/index";

// Spy on the one encryption step so the retry test can prove it runs once.
vi.mock("@omnicloud/crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@omnicloud/crypto")>();
  return { ...actual, encryptFile: vi.fn(actual.encryptFile) };
});

interface MultipartPart {
  fieldName: string;
  filename: string | null;
  value: Buffer;
}

interface CapturedUpload {
  idempotencyKey: string | null;
  /** The raw multipart body exactly as sent (headers + bytes). */
  rawBody: Buffer;
  parts: MultipartPart[];
}

interface StoredFile {
  name: string;
  envelope: Buffer;
  wrappedKey: string;
  metadataBlob: string;
  keyEpoch: number;
}

/** Splits a raw multipart body at the boundary; bytes travel through latin1. */
function parseMultipart(body: Uint8Array, boundary: string): MultipartPart[] {
  const raw = Buffer.from(body).toString("latin1");
  const out: MultipartPart[] = [];
  for (const segment of raw.split(`--${boundary}`)) {
    if (segment === "") continue;
    if (segment.startsWith("--")) break; // closing boundary
    if (!segment.startsWith("\r\n")) continue;
    let part = segment.slice(2);
    if (part.endsWith("\r\n")) part = part.slice(0, -2); // CRLF belongs to the next boundary
    const splitAt = part.indexOf("\r\n\r\n");
    if (splitAt === -1) continue;
    const headers = part.slice(0, splitAt);
    const value = part.slice(splitAt + 4);
    out.push({
      fieldName: /name="([^"]*)"/.exec(headers)?.[1] ?? "",
      filename: /filename="([^"]*)"/.exec(headers)?.[1] ?? null,
      value: Buffer.from(value, "latin1"),
    });
  }
  return out;
}

function fieldText(parts: MultipartPart[], name: string): string {
  const part = parts.find((p) => p.fieldName === name);
  if (!part) throw new Error(`multipart field "${name}" is missing`);
  return part.value.toString("utf8");
}

function filePart(parts: MultipartPart[]): MultipartPart {
  const part = parts.find((p) => p.fieldName === "file");
  if (!part) throw new Error("multipart file part is missing");
  return part;
}

function encryptionDto(id: string, stored: StoredFile): FileDTO {
  return {
    id,
    name: stored.name,
    size: stored.envelope.byteLength,
    mimeType: "application/octet-stream",
    sha256: "0000000000000000000000000000000000000000000000000000000000000000",
    folderId: null,
    starred: false,
    trashed: false,
    deletedAt: null,
    versionCount: 1,
    currentVersionId: `${id}-v1`,
    encryptionFormat: "OCE1",
    wrappedKey: stored.wrappedKey,
    metadataBlob: stored.metadataBlob,
    keyEpoch: stored.keyEpoch,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function legacyDto(id: string): FileDTO {
  return {
    id,
    name: "legacy.txt",
    size: 6,
    mimeType: "text/plain",
    sha256: "0000000000000000000000000000000000000000000000000000000000000000",
    folderId: null,
    starred: false,
    trashed: false,
    deletedAt: null,
    versionCount: 1,
    currentVersionId: "legacy-v1",
    encryptionFormat: null,
    wrappedKey: null,
    metadataBlob: null,
    keyEpoch: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** In-memory OmniCloud files API: records uploads, serves DTOs and envelope bytes. */
function encryptedServer(options: { failFirstPost?: boolean; legacy?: boolean } = {}) {
  const uploads: CapturedUpload[] = [];
  const store = new Map<string, StoredFile>();
  let postCalls = 0;
  let counter = 0;

  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);

    if (method === "POST") {
      expect(url).toBe("https://omni.test/api/files");
      postCalls += 1;
      const body = init?.body;
      if (!(body instanceof Uint8Array)) {
        throw new Error("encrypted upload must send one multipart body");
      }
      const boundary = /boundary=(\S+)/.exec(headers.get("content-type") ?? "")?.[1];
      if (!boundary) throw new Error("multipart boundary missing");
      const parts = parseMultipart(body, boundary);
      uploads.push({
        idempotencyKey: headers.get("idempotency-key"),
        rawBody: Buffer.from(body),
        parts,
      });
      if (options.failFirstPost && postCalls === 1) {
        return Response.json({ error: { code: "UNAVAILABLE", message: "retry" } }, { status: 503 });
      }
      const file = filePart(parts);
      if (!file.filename) throw new Error("file part has no filename");
      const stored: StoredFile = {
        name: file.filename,
        envelope: file.value,
        wrappedKey: fieldText(parts, "wrappedKey"),
        metadataBlob: fieldText(parts, "metadataBlob"),
        keyEpoch: Number(fieldText(parts, "keyEpoch")),
      };
      counter += 1;
      const id = `file-${counter}`;
      store.set(id, stored);
      return Response.json({ file: encryptionDto(id, stored) }, { status: 201 });
    }

    const downloadMatch = /^https:\/\/omni\.test\/api\/files\/([^/?]+)\/download$/.exec(url);
    if (downloadMatch) {
      const stored = store.get(downloadMatch[1] ?? "");
      if (!stored) return new Response("not found", { status: 404 });
      return new Response(new Uint8Array(stored.envelope), {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(stored.envelope.byteLength),
        },
      });
    }

    const getMatch = /^https:\/\/omni\.test\/api\/files\/([^/?]+)$/.exec(url);
    if (getMatch) {
      const id = getMatch[1] ?? "";
      if (options.legacy) return Response.json({ file: legacyDto(id) });
      const stored = store.get(id);
      if (!stored) return new Response("not found", { status: 404 });
      return Response.json({ file: encryptionDto(id, stored) });
    }

    throw new Error(`unexpected request: ${method} ${url}`);
  }) as unknown as typeof fetch;

  return {
    client: new OmniCloudClient({
      baseUrl: "https://omni.test",
      fetchImpl,
      retry: { attempts: 1, baseDelayMs: 1 },
    }),
    uploads,
    store,
  };
}

async function decryptCaptured(
  parts: MultipartPart[],
  urk: Uint8Array,
): Promise<{ plaintext: Uint8Array; metadata: FileMetadata }> {
  const envelope = filePart(parts).value;
  const header = readHeader(envelope);
  return decryptFile({
    urk,
    fileId: header.fileId,
    versionId: header.versionId,
    keyEpoch: header.keyEpoch,
    envelope,
    wrappedKey: Buffer.from(fieldText(parts, "wrappedKey"), "base64"),
    metadataBlob: Buffer.from(fieldText(parts, "metadataBlob"), "base64"),
  });
}

beforeEach(() => {
  vi.mocked(encryptFile).mockClear();
});

describe("uploadEncrypted multipart layout", () => {
  it("places the four encryption fields before the file part and the body decrypts", async () => {
    const { client, uploads } = encryptedServer();
    const urk = generateUrk();
    const plaintext = new TextEncoder().encode("attack at dawn, at dawn exactly");

    const result = await uploadEncrypted(
      client,
      { data: plaintext },
      {
        name: "secret-plan.pdf",
        mimeType: "application/pdf",
        description: "board deck",
        urk,
      },
    );

    expect(uploads).toHaveLength(1);
    const upload = uploads[0]!;
    expect(upload.parts.map((p) => p.fieldName)).toEqual([
      "encryptionFormat",
      "wrappedKey",
      "metadataBlob",
      "keyEpoch",
      "file",
    ]);
    expect(fieldText(upload.parts, "encryptionFormat")).toBe("OCE1");
    expect(fieldText(upload.parts, "keyEpoch")).toMatch(/^\d+$/);
    expect(fieldText(upload.parts, "wrappedKey")).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(fieldText(upload.parts, "metadataBlob")).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(filePart(upload.parts).filename).toBe("secret-plan.pdf");
    expect(upload.idempotencyKey).toBeTruthy();

    const { plaintext: decrypted, metadata } = await decryptCaptured(upload.parts, urk);
    expect(Buffer.from(decrypted).equals(Buffer.from(plaintext))).toBe(true);
    expect(metadata).toEqual({
      name: "secret-plan.pdf",
      mimeType: "application/pdf",
      description: "board deck",
    });

    expect(result.fileId).toBe(result.file.id);
    expect(result.versionId).toBe(result.file.currentVersionId);
    expect(result.file.encryptionFormat).toBe("OCE1");
  });

  it("keeps the plaintext name only in the multipart filename", async () => {
    const { client, uploads } = encryptedServer();
    const urk = generateUrk();
    const name = "Q3-earnings-secret.pdf";

    await client.files.uploadEncrypted(
      { data: new TextEncoder().encode("numbers nobody may see") },
      { name, urk },
    );

    const upload = uploads[0]!;
    const raw = upload.rawBody.toString("latin1");
    // The name survives exactly once, inside the file part's filename parameter.
    expect(raw.split(name)).toHaveLength(2);
    expect(raw).toContain(`filename="${name}"`);
    // Neither the envelope nor the metadata ciphertext carries it as plaintext.
    expect(filePart(upload.parts).value.includes(name)).toBe(false);
    const metadataBlob = Buffer.from(fieldText(upload.parts, "metadataBlob"), "base64");
    expect(metadataBlob.includes(name)).toBe(false);
  });

  it("reads a file from disk and places folderId ahead of the file part", async () => {
    const { client, uploads } = encryptedServer();
    const dir = mkdtempSync(join(tmpdir(), "omni-enc-"));
    const path = join(dir, "from-disk.bin");
    const onDisk = Buffer.from("disk-plaintext-bytes");
    writeFileSync(path, onDisk);
    const urk = generateUrk();

    await client.files.uploadEncrypted({ path }, { name: "from-disk.bin", folderId: "fld-1", urk });

    const upload = uploads[0]!;
    expect(upload.parts.map((p) => p.fieldName)).toEqual([
      "folderId",
      "encryptionFormat",
      "wrappedKey",
      "metadataBlob",
      "keyEpoch",
      "file",
    ]);
    expect(fieldText(upload.parts, "folderId")).toBe("fld-1");
    const { plaintext } = await decryptCaptured(upload.parts, urk);
    expect(Buffer.from(plaintext).equals(onDisk)).toBe(true);
  });
});

describe("downloadEncrypted roundtrip", () => {
  it("roundtrips through uploadEncrypted → downloadEncrypted", async () => {
    const { client } = encryptedServer();
    const urk = generateUrk();
    const plaintext = new TextEncoder().encode("roundtrip payload, bytes and all");

    const uploaded = await client.files.uploadEncrypted(
      { data: plaintext },
      {
        name: "roundtrip.txt",
        mimeType: "text/plain",
        description: "comes back whole",
        urk,
      },
    );

    const { plaintext: decrypted, metadata } = await client.files.downloadEncrypted(
      uploaded.fileId,
      { urk },
    );
    expect(Buffer.from(decrypted).equals(Buffer.from(plaintext))).toBe(true);
    expect(metadata).toEqual({
      name: "roundtrip.txt",
      mimeType: "text/plain",
      description: "comes back whole",
    });
  });

  it("decrypts via the standalone downloadEncrypted export", async () => {
    const { client } = encryptedServer();
    const urk = generateUrk();
    const plaintext = new TextEncoder().encode("standalone path");

    const uploaded = await uploadEncrypted(client, { data: plaintext }, { name: "s.txt", urk });
    const { plaintext: decrypted } = await downloadEncrypted(client, uploaded.fileId, { urk });
    expect(Buffer.from(decrypted).equals(Buffer.from(plaintext))).toBe(true);
  });

  it("rejects a legacy plaintext file instead of falling back", async () => {
    const { client } = encryptedServer({ legacy: true });
    const urk = generateUrk();

    const error: unknown = await client.files
      .downloadEncrypted("legacy-file", { urk })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OmniCloudError);
    expect(error).toMatchObject({ code: "NOT_ENCRYPTED" });
    expect((error as OmniCloudError).message).toMatch(/not encrypted/i);
  });
});

describe("uploadEncrypted retry", () => {
  it("encrypts once and replays the same envelope and operationId", async () => {
    const { client, uploads } = encryptedServer({ failFirstPost: true });
    const urk = generateUrk();
    const plaintext = new TextEncoder().encode("retry me once");

    const result = await client.files.uploadEncrypted(
      { data: plaintext },
      { name: "retry.bin", urk, retry: 1, operationId: "op_retry_0001" },
    );

    expect(result.fileId).toBe("file-1");
    expect(uploads).toHaveLength(2);
    expect(uploads[0]!.idempotencyKey).toBe("op_retry_0001");
    expect(uploads[1]!.idempotencyKey).toBe("op_retry_0001");

    const first = filePart(uploads[0]!.parts).value;
    const second = filePart(uploads[1]!.parts).value;
    expect(first.equals(second)).toBe(true);
    expect(fieldText(uploads[0]!.parts, "wrappedKey")).toBe(
      fieldText(uploads[1]!.parts, "wrappedKey"),
    );

    // Exactly one encryption for the whole logical upload.
    expect(vi.mocked(encryptFile)).toHaveBeenCalledTimes(1);
    const { plaintext: decrypted } = await decryptCaptured(uploads[1]!.parts, urk);
    expect(Buffer.from(decrypted).equals(Buffer.from(plaintext))).toBe(true);
  });

  it("does not retry permanent failures and still encrypts only once", async () => {
    const fetchImpl = (async () =>
      Response.json(
        { error: { code: "BAD_REQUEST", message: "nope" } },
        { status: 400 },
      )) as typeof fetch;
    const client = new OmniCloudClient({
      baseUrl: "https://omni.test",
      fetchImpl,
      retry: { attempts: 1, baseDelayMs: 1 },
    });
    const urk = generateUrk();

    await expect(
      client.files.uploadEncrypted(
        { data: new TextEncoder().encode("x") },
        { name: "x.bin", urk, retry: 1 },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(vi.mocked(encryptFile)).toHaveBeenCalledTimes(1);
  });
});
