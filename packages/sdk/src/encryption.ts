import {
  HEADER_SIZE,
  KEY_EPOCH_V1,
  decryptChunks,
  decryptFile,
  decryptMetadata,
  deriveKek,
  deriveMek,
  encryptChunks,
  encryptFile,
  encryptMetadata,
  generateDek,
  generateId,
  readHeader,
  sha256Hex,
  wrapDek,
} from "@omnicloud/crypto";
import type { FileMetadata } from "@omnicloud/crypto";
import type { FileDTO, FileVersionDTO } from "@omnicloud/shared";
import {
  OmniCloudError,
  isRetryableStatus,
  multipartHead,
  nodeMultipartStream,
  safeJsonParse,
  sleep,
} from "./client";
import type { OmniCloudClient } from "./client";

/**
 * Client-side end-to-end encryption (OCE1) for the files API.
 *
 * `uploadEncrypted` encrypts the plaintext exactly once and then POSTs the
 * envelope with the four OCE1 text fields ahead of the file part (the server
 * reads them as the multipart body arrives). Retries replay the very same
 * envelope and idempotency key, so a lost response never re-encrypts.
 *
 * `downloadEncrypted` refuses anything that is not OCE1: there is no silent
 * fallback to plaintext anywhere in this module.
 */

/** Plaintext source for an encrypted upload: bytes in memory, or a file path (Node). */
export type EncryptedUploadInput = { data: Uint8Array } | { path: string };

export interface EncryptedUploadOptions {
  /** Plaintext filename; sent as the multipart filename and encrypted into metadataBlob. */
  name: string;
  mimeType?: string;
  description?: string;
  /** User root key (URK) that wraps the file's data key. */
  urk: Uint8Array;
  folderId?: string | null;
  /** Idempotency key for this logical upload; generated when omitted. */
  operationId?: string;
  /** Number of retry attempts for failed uploads. Default 2. */
  retry?: number;
  /** Aborts the upload. */
  signal?: AbortSignal;
}

export interface EncryptedUploadResult {
  file: FileDTO;
  /** Server-side file id, usable with `downloadEncrypted`. */
  fileId: string;
  /** Server-side id of the new version, or null when the response omitted it. */
  versionId: string | null;
}

export interface EncryptedDownloadOptions {
  /** User root key (URK) that unwraps the file's data key. */
  urk: Uint8Array;
}

export interface EncryptedDownloadResult {
  plaintext: Uint8Array;
  metadata: FileMetadata;
}

const OCE1 = "OCE1";

function randomId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "");
}

function toBase64(bytes: Uint8Array): string {
  const BufferCtor = (globalThis as { Buffer?: typeof Buffer }).Buffer;
  if (BufferCtor) return BufferCtor.from(bytes).toString("base64");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const BufferCtor = (globalThis as { Buffer?: typeof Buffer }).Buffer;
  if (BufferCtor) return new Uint8Array(BufferCtor.from(value, "base64"));
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function readPlaintext(input: EncryptedUploadInput): Promise<Uint8Array> {
  if ("path" in input) {
    const { readFile } = await import("node:fs/promises");
    return new Uint8Array(await readFile(input.path));
  }
  return input.data;
}

/** Assembles head + envelope + tail into one multipart body (no streaming needed: the envelope is already in memory). */
function buildEncryptedBody(
  boundary: string,
  fields: [string, string][],
  name: string,
  envelope: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const head = encoder.encode(multipartHead(boundary, fields, name));
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.byteLength + envelope.byteLength + tail.byteLength);
  body.set(head, 0);
  body.set(envelope, head.byteLength);
  body.set(tail, head.byteLength + envelope.byteLength);
  return body;
}

interface EncryptionFieldValues {
  wrappedKey: string;
  metadataBlob: string;
  keyEpoch: string;
}

async function postEncryptedOnce(
  client: OmniCloudClient,
  path: string,
  envelope: Uint8Array,
  fieldValues: EncryptionFieldValues,
  options: EncryptedUploadOptions,
  operationId: string,
): Promise<FileDTO> {
  const boundary = `omnicloud-${randomId()}`;
  const fields: [string, string][] = [];
  // Text fields must precede the file part: the server reads them as they arrive.
  if (path === "/api/files" && options.folderId) fields.push(["folderId", options.folderId]);
  fields.push(
    ["encryptionFormat", OCE1],
    ["wrappedKey", fieldValues.wrappedKey],
    ["metadataBlob", fieldValues.metadataBlob],
    ["keyEpoch", fieldValues.keyEpoch],
  );

  const body = buildEncryptedBody(boundary, fields, options.name, envelope);
  const response = await client.fetchImpl(`${client.baseUrl}${path}`, {
    method: "POST",
    headers: {
      ...client.defaultHeaders,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(body.byteLength),
      "Idempotency-Key": operationId,
    },
    body,
    credentials: "include",
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const text = await response.text();
  if (!response.ok) {
    const error = (
      safeJsonParse(text) as {
        error?: { code: string; message: string; requestId?: string };
      } | null
    )?.error;
    throw new OmniCloudError(
      response.status,
      error?.code ?? "UPLOAD_FAILED",
      error?.message ?? `Upload failed (${response.status})`,
      error?.requestId,
    );
  }
  return (JSON.parse(text) as { file: FileDTO }).file;
}

/**
 * Encrypts the plaintext once, then uploads the envelope with the OCE1 text
 * fields ahead of the file part. Retries replay the same envelope bytes and
 * operationId; encryption happens exactly once per logical upload.
 */
export async function uploadEncrypted(
  client: OmniCloudClient,
  input: EncryptedUploadInput,
  options: EncryptedUploadOptions,
): Promise<EncryptedUploadResult> {
  const plaintext = await readPlaintext(input);
  const encrypted = await encryptFile(plaintext, {
    urk: options.urk,
    metadata: {
      name: options.name,
      ...(options.mimeType !== undefined ? { mimeType: options.mimeType } : {}),
      ...(options.description !== undefined ? { description: options.description } : {}),
    },
  });

  const fieldValues: EncryptionFieldValues = {
    wrappedKey: toBase64(encrypted.wrappedKey),
    metadataBlob: toBase64(encrypted.metadataBlob),
    keyEpoch: String(encrypted.keyEpoch),
  };

  // One key for the whole operation, so every attempt is the same logical upload.
  const operationId = options.operationId ?? randomId();
  const attempts = Math.max(1, (options.retry ?? 2) + 1);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const file = await postEncryptedOnce(
        client,
        "/api/files",
        encrypted.envelope,
        fieldValues,
        options,
        operationId,
      );
      return { file, fileId: file.id, versionId: file.currentVersionId };
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted) throw error;
      if (error instanceof OmniCloudError && !isRetryableStatus(error.status)) throw error;
      if (attempt < attempts) await sleep(300 * 2 ** (attempt - 1), options.signal);
    }
  }
  throw lastError;
}

/**
 * Downloads an OCE1-encrypted file and decrypts it with the caller's URK.
 * Throws when the stored file is plaintext or not OCE1 — never falls back.
 */
export async function downloadEncrypted(
  client: OmniCloudClient,
  id: string,
  options: EncryptedDownloadOptions,
): Promise<EncryptedDownloadResult> {
  const file = await client.files.get(id);
  if (file.encryptionFormat !== OCE1) {
    const seen = file.encryptionFormat ?? null;
    throw new OmniCloudError(
      0,
      "NOT_ENCRYPTED",
      seen === null
        ? `File ${id} is not encrypted (stored as plaintext); downloadEncrypted only opens OCE1-encrypted files`
        : `File ${id} has unsupported encryptionFormat "${seen}"; downloadEncrypted only opens OCE1-encrypted files`,
    );
  }
  if (!file.wrappedKey || !file.metadataBlob) {
    throw new OmniCloudError(
      0,
      "INVALID_ENCRYPTION_METADATA",
      `File ${id} is marked OCE1 but its wrappedKey/metadataBlob is missing`,
    );
  }

  const download = await client.requestBinary(`/api/files/${id}/download`);
  const data = download.data;
  const envelope = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const header = readHeader(envelope);

  return decryptFile({
    urk: options.urk,
    fileId: header.fileId,
    versionId: header.versionId,
    keyEpoch: header.keyEpoch,
    envelope,
    wrappedKey: fromBase64(file.wrappedKey),
    metadataBlob: fromBase64(file.metadataBlob),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy migration (roadmap Phase 5 client side)
// ─────────────────────────────────────────────────────────────────────────────

export interface MigrateFileOptions {
  /** User root key (URK) that wraps the new version's data key. */
  urk: Uint8Array;
  /** Retry attempts for the replace upload. Default 2. */
  retry?: number;
  /** Aborts the upload phase. */
  signal?: AbortSignal;
}

export type MigrateStatus = "migrated" | "migrated_with_plaintext_history" | "already_migrated";

export interface MigrateFileResult {
  status: MigrateStatus;
  fileId: string;
  /** Plaintext versions still present after the run (history kept by policy). */
  plaintextVersionsRemaining: number;
}

function isPlaintext(version: FileVersionDTO): boolean {
  return (version.encryptionFormat ?? null) === null;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Decrypts the stored candidate, mapping any failure (corrupt bytes, bad
 * fields) to MIGRATION_VERIFY_FAILED so callers know nothing was deleted.
 */
async function verifyStoredCandidate(
  client: OmniCloudClient,
  fileId: string,
  urk: Uint8Array,
): Promise<{ plaintext: Uint8Array; metadata: FileMetadata }> {
  try {
    return await downloadEncrypted(client, fileId, { urk });
  } catch (error) {
    throw new OmniCloudError(
      0,
      "MIGRATION_VERIFY_FAILED",
      `Verification failed for ${fileId}: ${error instanceof Error ? error.message : String(error)}. Nothing was deleted; the plaintext original is untouched.`,
    );
  }
}

/**
 * Migrates a legacy (plaintext) file to OCE1 by replacing its current version,
 * or finishes a previously interrupted migration on resume.
 *
 * Inspect-first and idempotent: rerunning after any crash resumes from stored
 * state instead of duplicating work. The plaintext original is deleted only
 * after the stored ciphertext has been verified against it, and only when it
 * is the single historical version (no version history is lost). Multi-version
 * files keep their plaintext history; the result reports how much remains.
 *
 * Never falls back to plaintext and never deletes before verification.
 */
export async function migrateFile(
  client: OmniCloudClient,
  fileId: string,
  options: MigrateFileOptions,
): Promise<MigrateFileResult> {
  const file = await client.files.get(fileId);
  let versions = await client.files.versions(fileId);
  const plaintextCount = (list: FileVersionDTO[]) => list.filter(isPlaintext).length;

  if (file.encryptionFormat === OCE1 && plaintextCount(versions) === 0) {
    return { status: "already_migrated", fileId, plaintextVersionsRemaining: 0 };
  }

  if (file.encryptionFormat !== OCE1) {
    // ── LEGACY: encrypt the current plaintext and replace it ────────────────
    const source = await client.requestBinary(`/api/files/${fileId}/download`);
    const plaintext = new Uint8Array(
      source.data.buffer,
      source.data.byteOffset,
      source.data.byteLength,
    );
    const encrypted = await encryptFile(plaintext, {
      urk: options.urk,
      metadata: { name: file.name, mimeType: file.mimeType },
    });
    const fieldValues: EncryptionFieldValues = {
      wrappedKey: toBase64(encrypted.wrappedKey),
      metadataBlob: toBase64(encrypted.metadataBlob),
      keyEpoch: String(encrypted.keyEpoch),
    };

    const replaceOptions: EncryptedUploadOptions = {
      name: file.name,
      urk: options.urk,
      operationId: randomId(),
      retry: options.retry ?? 2,
      ...(options.signal ? { signal: options.signal } : {}),
    };
    let uploaded: FileDTO | null = null;
    let lastError: unknown;
    const attempts = Math.max(1, (replaceOptions.retry ?? 2) + 1);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        uploaded = await postEncryptedOnce(
          client,
          `/api/files/${fileId}/replace`,
          encrypted.envelope,
          fieldValues,
          replaceOptions,
          replaceOptions.operationId!,
        );
        break;
      } catch (error) {
        lastError = error;
        if (options.signal?.aborted) throw error;
        if (error instanceof OmniCloudError && !isRetryableStatus(error.status)) throw error;
        if (attempt < attempts) await sleep(300 * 2 ** (attempt - 1), options.signal);
      }
    }
    if (uploaded === null) throw lastError;
    if (uploaded.encryptionFormat !== OCE1) {
      throw new OmniCloudError(
        0,
        "MIGRATION_UPLOAD_FAILED",
        `File ${fileId} was not stored as OCE1 after replace; the plaintext original is untouched`,
      );
    }

    // Verify the stored ciphertext round-trips to the exact source bytes.
    const verified = await verifyStoredCandidate(client, fileId, options.urk);
    if (!bytesEqual(verified.plaintext, plaintext)) {
      throw new OmniCloudError(
        0,
        "MIGRATION_VERIFY_FAILED",
        `Verification failed for ${fileId}: decrypted content differs from the original. Nothing was deleted; the file still has its plaintext version.`,
      );
    }
  } else {
    // ── PENDING resume: the current version is OCE1 but plaintext history remains.
    // Verify against the recorded sha256 of the newest plaintext version.
    const legacy = versions
      .filter((v) => isPlaintext(v))
      .sort((a, b) => b.versionNumber - a.versionNumber)[0];
    if (legacy === undefined) {
      throw new OmniCloudError(
        0,
        "MIGRATION_STATE_INVALID",
        `File ${fileId} is OCE1 but no plaintext version remains to verify against`,
      );
    }
    const verified = await verifyStoredCandidate(client, fileId, options.urk);
    if (sha256Hex(verified.plaintext) !== legacy.sha256.toLowerCase()) {
      throw new OmniCloudError(
        0,
        "MIGRATION_VERIFY_FAILED",
        `Verification failed for ${fileId}: stored ciphertext does not match the recorded original hash. Nothing was deleted.`,
      );
    }
  }

  // ── Cleanup: drop the plaintext predecessor only when it is the sole
  // historical version (total 2, exactly 1 plaintext) — no history is lost
  // because the verified ciphertext is the same content. Multi-version files
  // keep their history and report the remaining plaintext versions.
  versions = await client.files.versions(fileId);
  if (plaintextCount(versions) === 1 && versions.length === 2) {
    await client.request("POST", `/api/files/${fileId}/versions/prune`, {
      policy: "KEEP_LATEST_N",
      count: 0,
    });
    versions = await client.files.versions(fileId);
  }

  const remaining = plaintextCount(versions);
  return {
    status: remaining === 0 ? "migrated" : "migrated_with_plaintext_history",
    fileId,
    plaintextVersionsRemaining: remaining,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming large files (roadmap Phase 3 / plan M5) — Node only
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of encrypting a file to an on-disk ciphertext spool.
 *
 * The spool is a private (0600) temp file holding the complete OCE1 envelope.
 * Call `dispose()` once the upload has committed (or failed) to delete it.
 */
export interface SpoolEncryption {
  spoolPath: string;
  /** Ciphertext size on disk (header + records + manifest). */
  size: number;
  wrappedKey: Uint8Array;
  metadataBlob: Uint8Array;
  keyEpoch: number;
  fileId: Uint8Array;
  versionId: Uint8Array;
  dispose(): Promise<void>;
}

export interface EncryptToSpoolOptions {
  /** User root key (URK) that wraps the file's data key. */
  urk: Uint8Array;
  /** Encrypted metadata (name, MIME type, …). */
  metadata: FileMetadata;
  chunkSize?: number;
  /** Directory for the spool file; defaults to `<tmpdir>/omnicloud-spool`. */
  spoolDir?: string;
}

/**
 * Encrypts `inputPath` chunk-by-chunk into a 0600 spool file without ever
 * holding the whole plaintext or ciphertext in memory (peak usage is bounded
 * by the chunk size, not the file size). Wraps the DEK and encrypts metadata
 * up front so the upload fields are available before any bytes are sent.
 *
 * Node only. The spool must be deleted via `dispose()`.
 */
export async function encryptFileToSpool(
  inputPath: string,
  options: EncryptToSpoolOptions,
): Promise<SpoolEncryption> {
  const { createReadStream } = await import("node:fs");
  const { mkdir, open, rm, stat } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const info = await stat(inputPath);
  if (!info.isFile()) throw new Error(`${inputPath} is not a regular file`);

  const dir = options.spoolDir ?? join(tmpdir(), "omnicloud-spool");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const spoolPath = join(dir, `envelope-${randomId()}.oce1`);
  const dispose = async (): Promise<void> => {
    await rm(spoolPath, { force: true });
  };

  const fileId = generateId();
  const versionId = generateId();
  const keyEpoch = KEY_EPOCH_V1;
  const dek = generateDek();
  const ctx = { fileId, versionId, keyEpoch };

  // The wrapped key and metadata do not depend on the content, so they are
  // produced before streaming and are ready for the upload headers.
  const wrappedKey = wrapDek(deriveKek(options.urk), dek, ctx);
  const metadataBlob = encryptMetadata(deriveMek(options.urk), options.metadata, ctx);

  const handle = await open(spoolPath, "wx", 0o600);
  try {
    const source = createReadStream(inputPath);
    for await (const part of encryptChunks(source, {
      ...ctx,
      dek,
      ...(options.chunkSize !== undefined ? { chunkSize: options.chunkSize } : {}),
    })) {
      await handle.write(part);
    }
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await dispose();
    throw error;
  } finally {
    await handle.close().catch(() => {});
  }

  const { size } = await stat(spoolPath);
  return { spoolPath, size, wrappedKey, metadataBlob, keyEpoch, fileId, versionId, dispose };
}

async function postEncryptedStreamOnce(
  client: OmniCloudClient,
  path: string,
  spoolPath: string,
  spoolSize: number,
  fieldValues: EncryptionFieldValues,
  options: EncryptedUploadOptions,
  operationId: string,
): Promise<FileDTO> {
  const { createReadStream } = await import("node:fs");
  const boundary = `omnicloud-${randomId()}`;
  const fields: [string, string][] = [];
  if (path === "/api/files" && options.folderId) fields.push(["folderId", options.folderId]);
  fields.push(
    ["encryptionFormat", OCE1],
    ["wrappedKey", fieldValues.wrappedKey],
    ["metadataBlob", fieldValues.metadataBlob],
    ["keyEpoch", fieldValues.keyEpoch],
  );

  // The spool is re-opened on every attempt, so a retry streams the very same
  // ciphertext bytes without re-encrypting or buffering the file.
  const head = multipartHead(boundary, fields, options.name);
  const tail = `\r\n--${boundary}--\r\n`;
  const body = nodeMultipartStream(head, createReadStream(spoolPath), tail);
  const response = await client.fetchImpl(`${client.baseUrl}${path}`, {
    method: "POST",
    headers: {
      ...client.defaultHeaders,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(Buffer.byteLength(head) + spoolSize + Buffer.byteLength(tail)),
      "Idempotency-Key": operationId,
    },
    body,
    credentials: "include",
    duplex: "half",
    ...(options.signal ? { signal: options.signal } : {}),
  } as RequestInit);

  const text = await response.text();
  if (!response.ok) {
    const error = (
      safeJsonParse(text) as {
        error?: { code: string; message: string; requestId?: string };
      } | null
    )?.error;
    throw new OmniCloudError(
      response.status,
      error?.code ?? "UPLOAD_FAILED",
      error?.message ?? `Upload failed (${response.status})`,
      error?.requestId,
    );
  }
  return (JSON.parse(text) as { file: FileDTO }).file;
}

/**
 * Streams a file from disk: encrypts it into a spool (bounded memory), then
 * uploads the spool as one multipart body, re-opening it on every retry with
 * the same envelope bytes and operationId. The spool is deleted afterwards,
 * on success or failure.
 *
 * Node only. Never falls back to plaintext: the upload always carries the
 * OCE1 encryption fields and ciphertext.
 */
export async function uploadEncryptedStream(
  client: OmniCloudClient,
  inputPath: string,
  options: EncryptedUploadOptions & { spoolDir?: string },
): Promise<EncryptedUploadResult> {
  const name = options.name;
  const spool = await encryptFileToSpool(inputPath, {
    urk: options.urk,
    metadata: {
      name,
      ...(options.mimeType !== undefined ? { mimeType: options.mimeType } : {}),
      ...(options.description !== undefined ? { description: options.description } : {}),
    },
    ...(options.spoolDir !== undefined ? { spoolDir: options.spoolDir } : {}),
  });
  try {
    const fieldValues: EncryptionFieldValues = {
      wrappedKey: toBase64(spool.wrappedKey),
      metadataBlob: toBase64(spool.metadataBlob),
      keyEpoch: String(spool.keyEpoch),
    };
    const operationId = options.operationId ?? randomId();
    const attempts = Math.max(1, (options.retry ?? 2) + 1);
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const file = await postEncryptedStreamOnce(
          client,
          "/api/files",
          spool.spoolPath,
          spool.size,
          fieldValues,
          options,
          operationId,
        );
        return { file, fileId: file.id, versionId: file.currentVersionId };
      } catch (error) {
        lastError = error;
        if (options.signal?.aborted) throw error;
        if (error instanceof OmniCloudError && !isRetryableStatus(error.status)) throw error;
        if (attempt < attempts) await sleep(300 * 2 ** (attempt - 1), options.signal);
      }
    }
    throw lastError;
  } finally {
    await spool.dispose();
  }
}

async function* streamToAsyncIterable(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Splits an async byte source into the OCE1 header and a replayable envelope stream. */
async function splitHeader(
  source: AsyncGenerator<Uint8Array>,
): Promise<{ header: ReturnType<typeof readHeader>; envelope: AsyncGenerator<Uint8Array> }> {
  const parts: Uint8Array[] = [];
  let size = 0;
  // Manual iteration: a `break` inside `for await` would call return() on the
  // source generator and silently drop the rest of the download.
  const iterator = source[Symbol.asyncIterator]();
  while (true) {
    const next = await iterator.next();
    if (next.done) break;
    if (next.value) {
      parts.push(next.value);
      size += next.value.byteLength;
    }
    if (size >= HEADER_SIZE) break;
  }
  const prefix = concatBytes(...parts);
  if (prefix.byteLength < HEADER_SIZE) {
    throw new OmniCloudError(0, "TRUNCATED", "Download ended before the OCE1 header was complete");
  }
  const header = readHeader(prefix.subarray(0, HEADER_SIZE));
  // decryptChunks re-reads the header itself and checks it against the ctx
  // we peeked, so the stream must replay the header bytes first.
  const envelope = async function* () {
    yield prefix;
    for await (const part of source) yield part;
  };
  return { header, envelope: envelope() };
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export interface DownloadDecryptedToFileOptions {
  /** User root key (URK) that unwraps the file's data key. */
  urk: Uint8Array;
  /** Destination path. Written via a `.part` file renamed into place. */
  targetPath?: string;
  /**
   * Alternative to `targetPath`: called with the decrypted metadata (known
   * after the header is verified, before any plaintext is written) so the
   * caller can derive the destination — e.g. from the encrypted file name.
   */
  resolveTarget?: (metadata: FileMetadata) => string;
  signal?: AbortSignal;
}

export interface DownloadDecryptedToFileResult {
  path: string;
  /** Plaintext byte count. */
  bytes: number;
  /** sha256 of the decrypted plaintext (hex). */
  sha256: string;
  /** Decrypted file metadata (name, MIME type, …). */
  metadata: FileMetadata;
}

/**
 * Downloads an OCE1 file, decrypts it chunk-by-chunk, and writes the
 * plaintext to `targetPath` through a `.part` file that is renamed into place
 * only after the whole envelope — including the authenticated manifest — has
 * been verified. Peak memory is bounded by the chunk size, not the file size.
 * A truncated or tampered download leaves nothing at `targetPath`.
 *
 * Refuses non-OCE1 files: there is no silent plaintext fallback.
 */
export async function downloadDecryptedToFile(
  client: OmniCloudClient,
  id: string,
  options: DownloadDecryptedToFileOptions,
): Promise<DownloadDecryptedToFileResult> {
  const { createWriteStream } = await import("node:fs");
  const { rm, rename, stat } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const { pipeline } = await import("node:stream/promises");
  const { Readable } = await import("node:stream");

  const file = await client.files.get(id);
  if (file.encryptionFormat !== OCE1 || !file.wrappedKey || !file.metadataBlob) {
    const seen = file.encryptionFormat ?? null;
    throw new OmniCloudError(
      0,
      "NOT_ENCRYPTED",
      seen === null
        ? `File ${id} is not encrypted (stored as plaintext); only OCE1-encrypted files can be decrypted`
        : `File ${id} has unsupported encryptionFormat "${seen}"; only OCE1-encrypted files can be decrypted`,
    );
  }

  const download = await client.requestStream(`/api/files/${id}/download`);
  const source = streamToAsyncIterable(download.stream);
  const { header, envelope } = await splitHeader(source);
  const ctx = {
    fileId: header.fileId,
    versionId: header.versionId,
    keyEpoch: header.keyEpoch,
  };
  const metadata = decryptMetadata(deriveMek(options.urk), fromBase64(file.metadataBlob), ctx);
  const targetPath = options.targetPath ?? options.resolveTarget?.(metadata);
  if (!targetPath || targetPath.trim() === "") {
    throw new OmniCloudError(0, "INVALID_ARGUMENT", "A destination path is required");
  }

  const partPath = `${targetPath}.part`;
  const hash = createHash("sha256");
  let bytes = 0;
  const decrypted = (async function* () {
    for await (const chunk of decryptChunks({
      ...ctx,
      urk: options.urk,
      wrappedKey: fromBase64(file.wrappedKey!),
      envelope,
    })) {
      hash.update(chunk);
      bytes += chunk.byteLength;
      yield chunk;
    }
  })();

  try {
    await pipeline(
      Readable.from(decrypted),
      createWriteStream(partPath),
      options.signal ? { signal: options.signal } : {},
    );
    // Rename only after the pipeline completed: a truncated or tampered
    // envelope rejects inside decryptChunks and never reaches the target.
    await rename(partPath, targetPath);
    const { size } = await stat(targetPath);
    if (size !== bytes) {
      throw new OmniCloudError(
        0,
        "INTEGRITY_MISMATCH",
        `Written size ${size} does not match decrypted size ${bytes}`,
      );
    }
    return {
      path: targetPath,
      bytes,
      sha256: hash.digest("hex"),
      metadata,
    };
  } catch (error) {
    await rm(partPath, { force: true });
    throw error;
  }
}
