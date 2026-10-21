import {
  KEY_EPOCH_V1,
  encryptChunks,
  encryptMetadata,
  deriveKek,
  deriveMek,
  generateDek,
  generateId,
  wrapDek,
} from "@omnicloud/crypto";

/**
 * Browser-side chunked encryption for large files (plan M5).
 *
 * The plaintext is read in slices and fed through the shared OCE1
 * `encryptChunks`, so peak JS memory is bounded by the slice size rather than
 * the file size. Ciphertext is spooled to OPFS when the browser provides it
 * (Chromium: disk-backed, effectively unbounded); otherwise it accumulates as
 * Blob parts, which browsers page to disk but which we cap at
 * `BUFFERED_MAX_BYTES` with an explicit error instead of risking a tab crash.
 *
 * There is no plaintext fallback: any failure here rejects and nothing is
 * uploaded.
 */

/** Files at or above this size take the chunked path. */
export const STREAM_MIN_BYTES = 32 * 1024 * 1024;

/** Ceiling for the buffered (no-OPFS) fallback. */
export const BUFFERED_MAX_BYTES = 1024 * 1024 * 1024;

/** Plaintext read granularity. */
const SLICE_BYTES = 4 * 1024 * 1024;

export interface StreamedEncryption {
  /** The complete OCE1 envelope, backed by OPFS or Blob parts. */
  envelope: Blob;
  /** Base64 wrapped DEK. */
  wrappedKey: string;
  /** Base64 encrypted metadata. */
  metadataBlob: string;
  keyEpoch: number;
  /** The ids the metadata blob is bound to, as hex. */
  fileIdHex: string;
  versionIdHex: string;
  /** Removes any temporary spool (OPFS file). Safe to call more than once. */
  dispose: () => Promise<void>;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Reads the file in fixed slices as an async source for encryptChunks. */
async function* sliceSource(file: File): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < file.size; offset += SLICE_BYTES) {
    const slice = file.slice(offset, Math.min(offset + SLICE_BYTES, file.size));
    yield new Uint8Array(await slice.arrayBuffer());
  }
}

async function opfsAvailable(): Promise<boolean> {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage !== "undefined" &&
    typeof navigator.storage.getDirectory === "function"
  );
}

/**
 * Encrypts `file` with the active URK, chunk by chunk.
 * Throws on any failure; never returns plaintext bytes.
 */
export async function encryptFileStreaming(
  file: File,
  urk: Uint8Array,
): Promise<StreamedEncryption> {
  const fileId = generateId();
  const versionId = generateId();
  const keyEpoch = KEY_EPOCH_V1;
  const dek = generateDek();
  const ctx = { fileId, versionId, keyEpoch };
  const wrappedKey = wrapDek(deriveKek(urk), dek, ctx);
  const metadataBlob = encryptMetadata(
    deriveMek(urk),
    { name: file.name, mimeType: file.type || undefined },
    ctx,
  );

  const useOpfs = await opfsAvailable();
  if (!useOpfs && file.size > BUFFERED_MAX_BYTES) {
    throw new Error(
      `This browser has no OPFS storage, so files above ${Math.round(BUFFERED_MAX_BYTES / (1024 * 1024))} MiB cannot be encrypted in one upload. Split the file and upload the parts.`,
    );
  }

  const chunks = encryptChunks(sliceSource(file), { ...ctx, dek });

  let envelope: Blob;
  let dispose: () => Promise<void>;
  if (useOpfs) {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("omnicloud-spool", { create: true });
    const name = `envelope-${Date.now()}-${Math.random().toString(36).slice(2)}.oce1`;
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    let removed = false;
    dispose = async () => {
      if (removed) return;
      removed = true;
      await dir.removeEntry(name).catch(() => {
        // The browser may already have collected it; nothing to do.
      });
    };
    try {
      for await (const part of chunks) {
        // part.buffer is a plain ArrayBuffer at runtime (not a SharedArrayBuffer),
        // but TypeScript types Uint8Array.buffer as ArrayBufferLike.
        await writable.write(part.buffer as ArrayBuffer);
      }
      await writable.close();
      envelope = await handle.getFile();
    } catch (error) {
      await writable.abort().catch(() => {});
      await dispose();
      throw error;
    }
  } else {
    const parts: BlobPart[] = [];
    dispose = async () => {
      parts.length = 0;
    };
    for await (const part of chunks) {
      parts.push(part.slice().buffer as ArrayBuffer);
    }
    envelope = new Blob(parts, { type: "application/octet-stream" });
  }

  return {
    envelope,
    wrappedKey: bytesToBase64(wrappedKey),
    metadataBlob: bytesToBase64(metadataBlob),
    keyEpoch,
    fileIdHex: bytesToHex(ctx.fileId),
    versionIdHex: bytesToHex(ctx.versionId),
    dispose,
  };
}
