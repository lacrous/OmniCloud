import { describe, expect, it } from "vitest";
import { encryptFile, sha256Hex } from "@omnicloud/crypto";
import type { FileDTO, FileVersionDTO } from "@omnicloud/shared";
import { OmniCloudClient, OmniCloudError, generateUrk, migrateFile } from "../src/index";

// ── Minimal multipart helpers (kept local to this suite) ─────────────────────

interface MultipartPart {
  fieldName: string;
  filename: string | null;
  value: Buffer;
}

function parseMultipart(body: Uint8Array, boundary: string): MultipartPart[] {
  const raw = Buffer.from(body).toString("latin1");
  const out: MultipartPart[] = [];
  for (const segment of raw.split(`--${boundary}`)) {
    if (segment === "") continue;
    if (segment.startsWith("--")) break;
    if (!segment.startsWith("\r\n")) continue;
    const part = segment.slice(2).endsWith("\r\n") ? segment.slice(2, -2) : segment.slice(2);
    const splitAt = part.indexOf("\r\n\r\n");
    if (splitAt === -1) continue;
    const headers = part.slice(0, splitAt);
    out.push({
      fieldName: /name="([^"]*)"/.exec(headers)?.[1] ?? "",
      filename: /filename="([^"]*)"/.exec(headers)?.[1] ?? null,
      value: Buffer.from(part.slice(splitAt + 4), "latin1"),
    });
  }
  return out;
}

function fieldText(parts: MultipartPart[], name: string): string {
  const part = parts.find((p) => p.fieldName === name);
  if (!part) throw new Error(`multipart field "${name}" is missing`);
  return part.value.toString("utf8");
}

// ── In-memory files API covering the migration surface ───────────────────────

interface MockState {
  file: FileDTO;
  versions: FileVersionDTO[];
  plaintext: Buffer;
  envelope: Buffer | null;
  wrappedKey: string | null;
  metadataBlob: string | null;
  keyEpoch: number | null;
  replaceCalls: number;
  pruneCalls: { policy: string; count?: number }[];
  corruptDownloadAfterReplace: boolean;
}

function baseVersion(id: string, fileId: string, n: number, sha256: string): FileVersionDTO {
  return {
    id,
    fileId,
    versionNumber: n,
    size: 1,
    mimeType: "text/plain",
    sha256,
    telegramMessageId: 100 + n,
    isCurrent: false,
    encryptionFormat: null,
    wrappedKey: null,
    metadataBlob: null,
    keyEpoch: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function legacyFileDto(id: string, versionCount: number): FileDTO {
  return {
    id,
    name: "legacy.txt",
    size: 1,
    mimeType: "text/plain",
    sha256: "0000000000000000000000000000000000000000000000000000000000000000",
    folderId: null,
    starred: false,
    trashed: false,
    deletedAt: null,
    versionCount,
    currentVersionId: `f1-v${versionCount}`,
    encryptionFormat: null,
    wrappedKey: null,
    metadataBlob: null,
    keyEpoch: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function encryptedFileDto(state: MockState, currentId: string): FileDTO {
  return {
    ...state.file,
    encryptionFormat: "OCE1",
    wrappedKey: state.wrappedKey,
    metadataBlob: state.metadataBlob,
    keyEpoch: state.keyEpoch,
    versionCount: state.versions.length,
    currentVersionId: currentId,
  };
}

/** Starts a mock API for a legacy file with the given plaintext versions (last = current). */
function migrationServer(contents: {
  legacyVersions: string[];
  pendingEnvelope?: {
    envelope: Buffer;
    wrappedKey: string;
    metadataBlob: string;
    keyEpoch: number;
  };
}) {
  const state: MockState = {
    file: legacyFileDto("f1", contents.legacyVersions.length),
    versions: [],
    plaintext: Buffer.from(contents.legacyVersions[contents.legacyVersions.length - 1] ?? ""),
    envelope: null,
    wrappedKey: null,
    metadataBlob: null,
    keyEpoch: null,
    replaceCalls: 0,
    pruneCalls: [],
    corruptDownloadAfterReplace: false,
  };
  contents.legacyVersions.forEach((c, i) => {
    const v = baseVersion(`f1-v${i + 1}`, "f1", i + 1, sha256Hex(new TextEncoder().encode(c)));
    v.size = Buffer.byteLength(c);
    v.isCurrent = i === contents.legacyVersions.length - 1;
    state.versions.push(v);
  });
  if (contents.pendingEnvelope) {
    // Simulate "replace committed, verification/cleanup not yet done".
    const enc = contents.pendingEnvelope;
    const n = state.versions.length + 1;
    state.envelope = enc.envelope;
    state.wrappedKey = enc.wrappedKey;
    state.metadataBlob = enc.metadataBlob;
    state.keyEpoch = enc.keyEpoch;
    state.versions.push({
      ...baseVersion(`f1-v${n}`, "f1", n, "0".repeat(64)),
      isCurrent: true,
      encryptionFormat: "OCE1",
      wrappedKey: enc.wrappedKey,
      metadataBlob: enc.metadataBlob,
      keyEpoch: enc.keyEpoch,
    });
    state.versions.forEach((v) => {
      v.isCurrent = v.versionNumber === n;
    });
    state.file = encryptedFileDto(state, `f1-v${n}`);
  }

  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);

    if (method === "POST" && url.endsWith("/replace")) {
      state.replaceCalls += 1;
      const body = init?.body;
      if (!(body instanceof Uint8Array)) throw new Error("replace must send one multipart body");
      const boundary = /boundary=(\S+)/.exec(headers.get("content-type") ?? "")?.[1];
      if (!boundary) throw new Error("multipart boundary missing");
      const parts = parseMultipart(body, boundary);
      const file = parts.find((p) => p.fieldName === "file");
      if (!file) throw new Error("file part missing");
      state.envelope = file.value;
      state.wrappedKey = fieldText(parts, "wrappedKey");
      state.metadataBlob = fieldText(parts, "metadataBlob");
      state.keyEpoch = Number(fieldText(parts, "keyEpoch"));

      const n = state.versions.length + 1;
      state.versions.push({
        ...baseVersion(`f1-v${n}`, "f1", n, "0".repeat(64)),
        isCurrent: true,
        encryptionFormat: "OCE1",
        wrappedKey: state.wrappedKey,
        metadataBlob: state.metadataBlob,
        keyEpoch: state.keyEpoch,
      });
      state.versions.forEach((v) => {
        v.isCurrent = v.versionNumber === n;
      });
      state.file = encryptedFileDto(state, `f1-v${n}`);
      return Response.json({ file: state.file }, { status: 201 });
    }

    if (method === "POST" && url.endsWith("/versions/prune")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        policy: string;
        count?: number;
      };
      state.pruneCalls.push(body);
      const currentId = state.file.currentVersionId;
      if (body.policy === "KEEP_LATEST_N") {
        const historical = state.versions
          .filter((v) => v.id !== currentId)
          .sort((a, b) => b.versionNumber - a.versionNumber);
        const doomed = new Set(historical.slice(body.count ?? 0).map((v) => v.id));
        const removed = doomed.size;
        state.versions = state.versions.filter((v) => !doomed.has(v.id));
        return Response.json({ removed });
      }
      return Response.json({ removed: 0 });
    }

    if (method === "GET" && url.endsWith("/versions")) {
      return Response.json({ versions: state.versions });
    }

    if (method === "GET" && url.endsWith("/download")) {
      if (state.envelope === null) {
        return new Response(new Uint8Array(state.plaintext), { status: 200 });
      }
      const bytes = new Uint8Array(state.envelope);
      if (state.corruptDownloadAfterReplace) bytes[bytes.length - 1]! ^= 0x80;
      return new Response(bytes, { status: 200 });
    }

    if (method === "GET") {
      return Response.json({ file: state.file });
    }

    throw new Error(`unexpected request: ${method} ${url}`);
  }) as unknown as typeof fetch;

  return {
    client: new OmniCloudClient({
      baseUrl: "https://omni.test",
      fetchImpl,
      retry: { attempts: 1, baseDelayMs: 1 },
    }),
    state,
  };
}

const CONTENT = "the original plaintext content that migration must preserve exactly";

function fileIds(state: MockState): { current: string; plaintext: FileVersionDTO[] } {
  return {
    current: state.file.currentVersionId ?? "",
    plaintext: state.versions.filter((v) => (v.encryptionFormat ?? null) === null),
  };
}

describe("migrateFile", () => {
  it("migrates a single-version legacy file and deletes the verified plaintext twin", async () => {
    const { client, state } = migrationServer({ legacyVersions: [CONTENT] });
    const urk = generateUrk();

    const result = await migrateFile(client, "f1", { urk });

    expect(result.status).toBe("migrated");
    expect(result.plaintextVersionsRemaining).toBe(0);
    expect(state.replaceCalls).toBe(1);
    expect(state.pruneCalls).toEqual([{ policy: "KEEP_LATEST_N", count: 0 }]);
    expect(state.versions).toHaveLength(1);
    expect(state.versions[0]!.encryptionFormat).toBe("OCE1");
    expect(fileIds(state).plaintext).toHaveLength(0);
  });

  it("keeps plaintext history for multi-version files and reports it", async () => {
    const { client, state } = migrationServer({
      legacyVersions: ["version one content", "version two content", CONTENT],
    });
    const urk = generateUrk();

    const result = await migrateFile(client, "f1", { urk });

    expect(result.status).toBe("migrated_with_plaintext_history");
    expect(result.plaintextVersionsRemaining).toBe(3);
    expect(state.pruneCalls).toHaveLength(0); // history is never destroyed
    expect(state.versions).toHaveLength(4);
    expect(state.file.encryptionFormat).toBe("OCE1");
    // The previous plaintext history is all still present.
    expect(fileIds(state).plaintext).toHaveLength(3);
  });

  it("is idempotent: rerunning after success changes nothing", async () => {
    const { client, state } = migrationServer({ legacyVersions: [CONTENT] });
    const urk = generateUrk();
    await migrateFile(client, "f1", { urk });
    const replaceAfterFirst = state.replaceCalls;
    const pruneAfterFirst = state.pruneCalls.length;

    const again = await migrateFile(client, "f1", { urk });

    expect(again.status).toBe("already_migrated");
    expect(again.plaintextVersionsRemaining).toBe(0);
    expect(state.replaceCalls).toBe(replaceAfterFirst);
    expect(state.pruneCalls).toHaveLength(pruneAfterFirst);
  });

  it("resumes a pending migration (replace committed, cleanup not done)", async () => {
    const urk = generateUrk();
    const encrypted = await encryptFile(new TextEncoder().encode(CONTENT), {
      urk,
      metadata: { name: "legacy.txt" },
    });
    const { client, state } = migrationServer({
      legacyVersions: [CONTENT],
      pendingEnvelope: {
        envelope: Buffer.from(encrypted.envelope),
        wrappedKey: Buffer.from(encrypted.wrappedKey).toString("base64"),
        metadataBlob: Buffer.from(encrypted.metadataBlob).toString("base64"),
        keyEpoch: encrypted.keyEpoch,
      },
    });
    expect(state.file.encryptionFormat).toBe("OCE1");
    expect(fileIds(state).plaintext).toHaveLength(1);

    const result = await migrateFile(client, "f1", { urk });

    expect(result.status).toBe("migrated");
    expect(result.plaintextVersionsRemaining).toBe(0);
    expect(state.replaceCalls).toBe(0); // resume never re-uploads
    expect(state.pruneCalls).toEqual([{ policy: "KEEP_LATEST_N", count: 0 }]);
    expect(state.versions).toHaveLength(1);
  });

  it("fails resume when the stored ciphertext does not match the recorded hash", async () => {
    const urk = generateUrk();
    const encrypted = await encryptFile(new TextEncoder().encode("SOMETHING ELSE ENTIRELY"), {
      urk,
      metadata: { name: "legacy.txt" },
    });
    const { client, state } = migrationServer({
      legacyVersions: [CONTENT],
      pendingEnvelope: {
        envelope: Buffer.from(encrypted.envelope),
        wrappedKey: Buffer.from(encrypted.wrappedKey).toString("base64"),
        metadataBlob: Buffer.from(encrypted.metadataBlob).toString("base64"),
        keyEpoch: encrypted.keyEpoch,
      },
    });

    await expect(migrateFile(client, "f1", { urk })).rejects.toMatchObject({
      code: "MIGRATION_VERIFY_FAILED",
    });
    expect(state.pruneCalls).toHaveLength(0);
    expect(fileIds(state).plaintext).toHaveLength(1); // original untouched
    expect(state.versions).toHaveLength(2);
  });

  it("verifies the fresh path byte-for-byte and refuses to delete on mismatch", async () => {
    const { client, state } = migrationServer({ legacyVersions: [CONTENT] });
    state.corruptDownloadAfterReplace = true;
    const urk = generateUrk();

    await expect(migrateFile(client, "f1", { urk })).rejects.toMatchObject({
      code: "MIGRATION_VERIFY_FAILED",
    });
    // Replace happened, but cleanup must not: the plaintext original remains.
    expect(state.replaceCalls).toBe(1);
    expect(state.pruneCalls).toHaveLength(0);
    expect(fileIds(state).plaintext).toHaveLength(1);
    expect(state.versions).toHaveLength(2);
  });

  it("still exposes a usable encrypted current version after a failed verify", async () => {
    const { client, state } = migrationServer({ legacyVersions: [CONTENT] });
    state.corruptDownloadAfterReplace = true;
    const urk = generateUrk();

    await expect(migrateFile(client, "f1", { urk })).rejects.toBeInstanceOf(OmniCloudError);
    // The file state is inspectable and a retry can finish verification.
    expect(state.file.encryptionFormat).toBe("OCE1");
    state.corruptDownloadAfterReplace = false;
    const resumed = await migrateFile(client, "f1", { urk });
    expect(resumed.status).toBe("migrated");
    expect(resumed.plaintextVersionsRemaining).toBe(0);
  });
});
