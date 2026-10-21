import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Streaming operations are intentionally slow (chunk-by-chunk crypto on disk);
// give these tests generous timeouts so they don't flake.
import { vi } from "vitest";
vi.setConfig({ testTimeout: 40000 });

import { encryptFile, sha256Hex } from "@omnicloud/crypto";
import type { FileDTO } from "@omnicloud/shared";
import { OmniCloudClient, OmniCloudError, generateUrk } from "../src/index";
import {
  downloadDecryptedToFile,
  encryptFileToSpool,
  uploadEncryptedStream,
} from "../src/encryption";

// ── Harness ──────────────────────────────────────────────────────────────────

let dir: string;
let spoolDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omnicloud-stream-"));
  spoolDir = join(dir, "spool");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Uint8Array | null;
}

async function readStreamBody(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  if (typeof body === "string") return new TextEncoder().encode(body);
  const reader = (body as ReadableStream<Uint8Array>).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      parts.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function makeClient(route: (req: CapturedRequest) => Response | Promise<Response>): {
  client: OmniCloudClient;
  requests: CapturedRequest[];
} {
  const requests: CapturedRequest[] = [];
  const client = new OmniCloudClient({
    baseUrl: "http://stream.test",
    token: "t".repeat(43),
    retry: { attempts: 1, baseDelayMs: 1 },
    fetchImpl: async (url, init) => {
      const req: CapturedRequest = {
        url: String(url),
        method: init?.method ?? "GET",
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: init?.body ? await readStreamBody(init.body) : null,
      };
      requests.push(req);
      return route(req);
    },
  });
  return { client, requests };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fileDto(overrides: Partial<FileDTO> = {}): FileDTO {
  return {
    id: "f-stream",
    name: "blob.bin",
    size: 1,
    mimeType: "application/octet-stream",
    sha256: "0".repeat(64),
    folderId: null,
    starred: false,
    trashed: false,
    deletedAt: null,
    versionCount: 1,
    currentVersionId: "v-stream",
    encryptionFormat: "OCE1",
    wrappedKey: null,
    metadataBlob: null,
    keyEpoch: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function parseMultipart(body: Uint8Array, boundary: string) {
  const raw = Buffer.from(body).toString("latin1");
  const parts: { fieldName: string; filename: string | null; value: Buffer }[] = [];
  for (const segment of raw.split(`--${boundary}`)) {
    if (segment === "") continue;
    if (segment.startsWith("--")) break;
    if (!segment.startsWith("\r\n")) continue;
    const part = segment.slice(2).endsWith("\r\n") ? segment.slice(2, -2) : segment.slice(2);
    const splitAt = part.indexOf("\r\n\r\n");
    if (splitAt === -1) continue;
    const headers = part.slice(0, splitAt);
    parts.push({
      fieldName: /name="([^"]*)"/.exec(headers)?.[1] ?? "",
      filename: /filename="([^"]*)"/.exec(headers)?.[1] ?? null,
      value: Buffer.from(part.slice(splitAt + 4), "latin1"),
    });
  }
  return parts;
}

function fieldText(parts: ReturnType<typeof parseMultipart>, name: string): string {
  const part = parts.find((p) => p.fieldName === name);
  if (!part) throw new Error(`multipart field "${name}" is missing`);
  return part.value.toString("utf8");
}

function patternedBytes(size: number, seed = 7): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) out[i] = (i * 31 + seed) & 0xff;
  return out;
}

// ── uploadEncryptedStream ────────────────────────────────────────────────────

describe("uploadEncryptedStream", () => {
  it("spools, streams and produces ciphertext the server cannot read", async () => {
    const urk = generateUrk();
    const plaintext = patternedBytes(3 * 1024 * 1024 + 12345); // spans several chunks
    const inputPath = join(dir, "big.bin");
    writeFileSync(inputPath, plaintext);

    const { client, requests } = makeClient((req) => {
      if (req.url.endsWith("/api/files") && req.method === "POST") {
        const match = /boundary=(\S+)/.exec(req.headers["Content-Type"] ?? "");
        if (!match?.[1]) throw new Error("no multipart boundary");
        const parts = parseMultipart(req.body!, match[1]);
        const envelope = parts.find((p) => p.filename !== null)!.value;
        expect(fieldText(parts, "encryptionFormat")).toBe("OCE1");
        // The wire bytes must be ciphertext, not the plaintext.
        expect(envelope.includes(Buffer.from(plaintext.subarray(0, 4096)))).toBe(false);
        const dto = fileDto({
          wrappedKey: fieldText(parts, "wrappedKey"),
          metadataBlob: fieldText(parts, "metadataBlob"),
        });
        return json({ file: dto }, 201);
      }
      return json({ error: { code: "NOT_FOUND" } }, 404);
    });

    const result = await uploadEncryptedStream(client, inputPath, {
      name: "big.bin",
      urk,
      spoolDir,
    });
    expect(result.fileId).toBe("f-stream");
    expect(requests).toHaveLength(1);
    // The spool is gone once the upload committed.
    expect(readdirSync(spoolDir)).toEqual([]);
  });

  it("replays the identical envelope and operationId on retry", async () => {
    const urk = generateUrk();
    const inputPath = join(dir, "retry.bin");
    writeFileSync(inputPath, patternedBytes(200_000, 11));

    let attempts = 0;
    const { client, requests } = makeClient((req) => {
      if (req.url.endsWith("/api/files") && req.method === "POST") {
        attempts += 1;
        if (attempts === 1) return json({ error: { code: "UNAVAILABLE" } }, 503);
        return json({ file: fileDto() }, 201);
      }
      return json({ error: { code: "NOT_FOUND" } }, 404);
    });

    const result = await uploadEncryptedStream(client, inputPath, {
      name: "retry.bin",
      urk,
      retry: 1,
      spoolDir,
    });
    expect(result.fileId).toBe("f-stream");
    expect(requests).toHaveLength(2);
    const first = requests[0]!;
    const second = requests[1]!;
    expect(first.headers["Idempotency-Key"]).toBe(second.headers["Idempotency-Key"]);
    // The multipart boundary is per-attempt; the file part inside must be the
    // exact same ciphertext (no re-encryption on retry).
    const envelopeOf = (req: (typeof requests)[number]): Buffer => {
      const boundary = /boundary=(\S+)/.exec(req.headers["Content-Type"] ?? "")?.[1];
      if (!boundary) throw new Error("no multipart boundary");
      const filePart = parseMultipart(req.body!, boundary).find((p) => p.filename !== null);
      if (!filePart) throw new Error("no file part");
      return filePart.value;
    };
    expect(envelopeOf(first).equals(envelopeOf(second))).toBe(true);
    expect(readdirSync(spoolDir)).toEqual([]);
  });

  it("an aborted upload rejects and still removes the spool", async () => {
    const urk = generateUrk();
    const inputPath = join(dir, "abort.bin");
    writeFileSync(inputPath, patternedBytes(500_000));

    const controller = new AbortController();
    const { client } = makeClient(async (req) => {
      if (req.url.endsWith("/api/files") && req.method === "POST") {
        controller.abort();
        throw new OmniCloudError(0, "ABORTED", "Request aborted");
      }
      return json({ error: { code: "NOT_FOUND" } }, 404);
    });

    await expect(
      uploadEncryptedStream(client, inputPath, {
        name: "abort.bin",
        urk,
        retry: 0,
        spoolDir,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(readdirSync(spoolDir)).toEqual([]);
  });

  it("encrypts to a 0600 spool whose bytes round-trip", async () => {
    const urk = generateUrk();
    const plaintext = patternedBytes(256 * 1024, 19);
    const inputPath = join(dir, "plain.bin");
    writeFileSync(inputPath, plaintext);

    const spool = await encryptFileToSpool(inputPath, {
      urk,
      metadata: { name: "plain.bin" },
      spoolDir,
    });
    try {
      expect(statSync(spool.spoolPath).mode & 0o777).toBe(0o600);
      const envelope = new Uint8Array(readFileSync(spool.spoolPath));
      const { decryptFile } = await import("@omnicloud/crypto");
      const out = await decryptFile({
        urk,
        fileId: spool.fileId,
        versionId: spool.versionId,
        keyEpoch: spool.keyEpoch,
        envelope,
        wrappedKey: spool.wrappedKey,
        metadataBlob: spool.metadataBlob,
      });
      expect(sha256Hex(out.plaintext)).toBe(sha256Hex(plaintext));
      expect(out.metadata.name).toBe("plain.bin");
    } finally {
      await spool.dispose();
    }
    expect(existsSync(spool.spoolPath)).toBe(false);
  });
});

// ── downloadDecryptedToFile ──────────────────────────────────────────────────

describe("downloadDecryptedToFile", () => {
  const plaintext = patternedBytes(400_000, 23); // spans several 64 KiB chunks
  let urk: Uint8Array;
  let envelope: Uint8Array;
  let wrappedKey: string;
  let metadataBlob: string;

  beforeEach(async () => {
    urk = generateUrk();
    const encrypted = await encryptFile(plaintext, {
      urk,
      metadata: { name: "report.txt", mimeType: "text/plain" },
    });
    envelope = encrypted.envelope;
    wrappedKey = Buffer.from(encrypted.wrappedKey).toString("base64");
    metadataBlob = Buffer.from(encrypted.metadataBlob).toString("base64");
  });

  function routes(opts: { serve?: Uint8Array } = {}) {
    const bytes = opts.serve ?? envelope;
    return (req: CapturedRequest): Response => {
      if (req.url.endsWith("/api/files/f-stream") && req.method === "GET") {
        return json({ file: fileDto({ wrappedKey, metadataBlob }) });
      }
      if (req.url.endsWith("/api/files/f-stream/download")) {
        // Serve in ragged chunks (splitting the header) to exercise the
        // header-peek and replay logic.
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const sizes = [3, 17, 64, 1000, 5000, bytes.length];
            let offset = 0;
            for (const size of sizes) {
              if (offset >= bytes.length) break;
              const end = Math.min(offset + size, bytes.length);
              controller.enqueue(bytes.slice(offset, end));
              offset = end;
            }
            controller.close();
          },
        });
        return new Response(stream, { status: 200 });
      }
      return json({ error: { code: "NOT_FOUND" } }, 404);
    };
  }

  it("streams the decryption to disk, byte-identical, with a matching sha256", async () => {
    const { client } = makeClient(routes());
    const target = join(dir, "out.bin");
    const result = await downloadDecryptedToFile(client, "f-stream", { urk, targetPath: target });
    expect(readFileSync(target)).toEqual(Buffer.from(plaintext));
    expect(result.bytes).toBe(plaintext.byteLength);
    expect(result.sha256).toBe(createHash("sha256").update(plaintext).digest("hex"));
    expect(result.metadata.name).toBe("report.txt");
    expect(existsSync(`${target}.part`)).toBe(false);
  });

  it("resolveTarget derives the destination from the decrypted metadata", async () => {
    const { client } = makeClient(routes());
    const result = await downloadDecryptedToFile(client, "f-stream", {
      urk,
      resolveTarget: (metadata) => join(dir, metadata.name),
    });
    expect(result.path).toBe(join(dir, "report.txt"));
    expect(readFileSync(result.path)).toEqual(Buffer.from(plaintext));
  });

  it("a truncated envelope rejects and leaves nothing behind", async () => {
    const { client } = makeClient(routes({ serve: envelope.slice(0, envelope.length - 900) }));
    const target = join(dir, "truncated.bin");
    await expect(
      downloadDecryptedToFile(client, "f-stream", { urk, targetPath: target }),
    ).rejects.toThrow();
    expect(existsSync(target)).toBe(false);
    expect(existsSync(`${target}.part`)).toBe(false);
  });

  it("a corrupted chunk rejects and leaves nothing behind", async () => {
    const corrupted = envelope.slice();
    corrupted[200] = (corrupted[200] ?? 0) ^ 0x40;
    const { client } = makeClient(routes({ serve: corrupted }));
    const target = join(dir, "corrupt.bin");
    await expect(
      downloadDecryptedToFile(client, "f-stream", { urk, targetPath: target }),
    ).rejects.toThrow();
    expect(existsSync(target)).toBe(false);
    expect(existsSync(`${target}.part`)).toBe(false);
  });

  it("refuses a plaintext (legacy) file outright", async () => {
    const { client } = makeClient((req) => {
      if (req.url.endsWith("/api/files/f-stream") && req.method === "GET") {
        return json({
          file: fileDto({ encryptionFormat: null, wrappedKey: null, metadataBlob: null }),
        });
      }
      return json({ error: { code: "NOT_FOUND" } }, 404);
    });
    await expect(
      downloadDecryptedToFile(client, "f-stream", { urk, targetPath: join(dir, "x") }),
    ).rejects.toThrow(/not encrypted/);
    expect(existsSync(join(dir, "x"))).toBe(false);
  });

  it("an aborted download rejects and cleans up the .part file", async () => {
    const controller = new AbortController();
    const { client } = makeClient((req) => {
      if (req.url.endsWith("/api/files/f-stream/download")) {
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(envelope.slice(0, 64));
            // Abort before the rest is served.
            controller.abort();
            c.error(new OmniCloudError(0, "ABORTED", "Request aborted"));
          },
        });
        return new Response(stream, { status: 200 });
      }
      if (req.url.endsWith("/api/files/f-stream") && req.method === "GET") {
        return json({ file: fileDto({ wrappedKey, metadataBlob }) });
      }
      return json({ error: { code: "NOT_FOUND" } }, 404);
    });
    const target = join(dir, "aborted.bin");
    await expect(
      downloadDecryptedToFile(client, "f-stream", {
        urk,
        targetPath: target,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(existsSync(target)).toBe(false);
    expect(existsSync(`${target}.part`)).toBe(false);
  });
});
