import {
  HEADER_SIZE,
  decryptChunks,
  decryptMetadata,
  deriveMek,
  readHeader,
} from "@omnicloud/crypto";
import type { FileDTO } from "@omnicloud/shared";
import { base64ToBytes } from "../lib/bytes";
import { getUrk } from "../lib/crypto-session";
import {
  api,
  ApiError,
  apiErrorFromText,
  ERROR_CODES,
  errorMessage,
  notifyUnauthorized,
} from "./client";

function downloadPath(id: string): string {
  return `/api/files/${encodeURIComponent(id)}/download`;
}

/**
 * Largest file that may be decrypted into memory for on-screen preview.
 * Anything above this uses the normal streaming download to disk instead, so a
 * preview click can never pull a huge file into the tab.
 */
export const PREVIEW_MAX_BYTES = 64 * 1024 * 1024;

/** Saves decrypted bytes via a Blob URL anchor. */
function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke once the browser has had time to start the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Fetches the stored object bytes (the OCE1 envelope) with the session cookie. */
/** Fetches raw stored bytes for a file (OCE1 envelope or legacy plaintext). */
export async function fetchFileBytes(id: string): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(downloadPath(id), { method: "GET", credentials: "same-origin" });
  } catch {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "Could not reach the server. Check your connection and try again.",
    );
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const error = apiErrorFromText(response.status, text);
    if (response.status === 401 && error.code !== ERROR_CODES.TELEGRAM_AUTH_REQUIRED)
      notifyUnauthorized();
    throw error;
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Converts a fetch body into an async byte source.
 */
async function* bodySource(response: Response): AsyncGenerator<Uint8Array> {
  const body = response.body;
  if (!body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    yield bytes;
    return;
  }
  const reader = body.getReader();
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

/**
 * Consumes just enough of the envelope to expose the OCE1 header, then returns
 * a stream that replays those bytes so `decryptChunks` can re-read and bind
 * the header itself. Manual iteration is required: breaking out of
 * `for await` would close the source and drop the rest of the download.
 */
async function splitHeader(
  source: AsyncGenerator<Uint8Array>,
): Promise<{ header: ReturnType<typeof readHeader>; envelope: AsyncGenerator<Uint8Array> }> {
  const parts: Uint8Array[] = [];
  let size = 0;
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
  let total = 0;
  for (const part of parts) total += part.byteLength;
  const prefix = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    prefix.set(part, offset);
    offset += part.byteLength;
  }
  if (prefix.byteLength < HEADER_SIZE) {
    throw new ApiError(0, "TRUNCATED", "The download ended before the file header was complete.");
  }
  const header = readHeader(prefix.subarray(0, HEADER_SIZE));
  const envelope = async function* () {
    yield prefix;
    for await (const part of source) yield part;
  };
  return { header, envelope: envelope() };
}

/**
 * Downloads a file. Plaintext files use the server's attachment response
 * exactly as before. OCE1 files are streamed and decrypted chunk-by-chunk;
 * the save only happens after the authenticated manifest verifies, so a failed
 * or truncated decryption produces an error and never a partial file.
 *
 * Pass `knownFile` when the caller already has the DTO to avoid a GET.
 */
export interface DecryptedPreview {
  /** Decrypted bytes; the caller must not cache or persist them. */
  blob: Blob;
  /** Decrypted MIME type from the encrypted metadata, falling back to the DTO. */
  mimeType: string;
  /** Decrypted file name from the encrypted metadata. */
  name: string;
  /** Decrypted plaintext byte count. */
  bytes: number;
}

/**
 * Downloads an OCE1 file and decrypts it into memory for on-screen preview.
 *
 * Refuses anything above `PREVIEW_MAX_BYTES` so previewing cannot be used to
 * pull an arbitrarily large file into a tab; callers should fall back to the
 * normal download (which streams to disk) for bigger files. Never previews
 * legacy plaintext files — those use the server's own preview/save path.
 *
 * The returned Blob lives only in the caller's object URL and must be revoked.
 */
export async function fetchDecryptedPreview(
  id: string,
  knownFile?: FileDTO | null,
): Promise<DecryptedPreview> {
  const file = knownFile ?? (await api.files.get(id)).file;
  if (file.encryptionFormat !== "OCE1") {
    throw new ApiError(
      0,
      "NOT_ENCRYPTED",
      `"${file.name}" is not encrypted; previews use the normal path.`,
    );
  }
  if (file.size > PREVIEW_MAX_BYTES) {
    throw new ApiError(
      0,
      "PREVIEW_TOO_LARGE",
      `"${file.name}" is too large to preview. Download it instead.`,
    );
  }

  const urk = getUrk();
  if (urk === null) {
    throw new ApiError(
      0,
      "ENCRYPTION_KEY_REQUIRED",
      `"${file.name}" is encrypted. Generate or unlock your encryption key in Settings, then try again.`,
    );
  }
  if (
    file.wrappedKey === null ||
    file.wrappedKey === undefined ||
    file.metadataBlob === null ||
    file.metadataBlob === undefined
  ) {
    throw new ApiError(
      0,
      "ENCRYPTION_METADATA_MISSING",
      `"${file.name}" is missing its encryption metadata and cannot be decrypted.`,
    );
  }

  let response: Response;
  try {
    response = await fetch(downloadPath(file.id), { method: "GET", credentials: "same-origin" });
  } catch {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "Could not reach the server. Check your connection and try again.",
    );
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const error = apiErrorFromText(response.status, text);
    if (response.status === 401 && error.code !== ERROR_CODES.TELEGRAM_AUTH_REQUIRED)
      notifyUnauthorized();
    throw error;
  }

  try {
    const source = bodySource(response);
    const { header, envelope } = await splitHeader(source);
    const ctx = {
      fileId: header.fileId,
      versionId: header.versionId,
      keyEpoch: file.keyEpoch ?? header.keyEpoch,
    };
    const metadata = decryptMetadata(deriveMek(urk), base64ToBytes(file.metadataBlob), ctx);
    const parts: BlobPart[] = [];
    let bytes = 0;
    for await (const chunk of decryptChunks({
      ...ctx,
      urk,
      wrappedKey: base64ToBytes(file.wrappedKey),
      envelope,
    })) {
      parts.push(chunk.slice().buffer as ArrayBuffer);
      bytes += chunk.byteLength;
    }
    const name = metadata.name || file.name;
    const mimeType = metadata.mimeType ?? file.mimeType ?? "application/octet-stream";
    return { blob: new Blob(parts, { type: mimeType }), mimeType, name, bytes };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      0,
      "DECRYPT_FAILED",
      `Could not decrypt "${file.name}": ${errorMessage(error, "wrong key or damaged data")} Nothing was shown.`,
    );
  }
}

/**
 * Loads the decrypted bytes of a small image for use as a drive thumbnail.
 *
 * Encrypted files go through the same chunked decrypt as the preview, so the
 * authenticated manifest is verified before any bytes are shown. Legacy
 * plaintext files are fetched as-is. The result is never written to disk or
 * cached by the browser — the caller holds it as an object URL.
 */
export async function fetchThumbnailBlob(id: string, knownFile?: FileDTO | null): Promise<Blob> {
  const file = knownFile ?? (await api.files.get(id)).file;
  if (file.encryptionFormat === "OCE1") {
    const preview = await fetchDecryptedPreview(id, file);
    return preview.blob;
  }
  const bytes = await fetchFileBytes(file.id);
  return new Blob([bytes as BlobPart], { type: file.mimeType || "application/octet-stream" });
}

export async function downloadFile(id: string, knownFile?: FileDTO | null): Promise<void> {
  const file = knownFile ?? (await api.files.get(id)).file;
  if (file.encryptionFormat !== "OCE1") {
    api.files.download(file.id);
    return;
  }

  const urk = getUrk();
  if (urk === null) {
    throw new ApiError(
      0,
      "ENCRYPTION_KEY_REQUIRED",
      `"${file.name}" is encrypted. Generate or unlock your encryption key in Settings, then try again.`,
    );
  }
  if (
    file.wrappedKey === null ||
    file.wrappedKey === undefined ||
    file.metadataBlob === null ||
    file.metadataBlob === undefined
  ) {
    throw new ApiError(
      0,
      "ENCRYPTION_METADATA_MISSING",
      `"${file.name}" is missing its encryption metadata and cannot be decrypted.`,
    );
  }

  let response: Response;
  try {
    response = await fetch(downloadPath(file.id), { method: "GET", credentials: "same-origin" });
  } catch {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "Could not reach the server. Check your connection and try again.",
    );
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const error = apiErrorFromText(response.status, text);
    if (response.status === 401 && error.code !== ERROR_CODES.TELEGRAM_AUTH_REQUIRED)
      notifyUnauthorized();
    throw error;
  }

  try {
    const source = bodySource(response);
    const { header, envelope } = await splitHeader(source);
    const ctx = {
      fileId: header.fileId,
      versionId: header.versionId,
      keyEpoch: file.keyEpoch ?? header.keyEpoch,
    };
    const metadata = decryptMetadata(deriveMek(urk), base64ToBytes(file.metadataBlob), ctx);

    // Decrypt chunk-by-chunk into Blob parts (browser-managed storage — no
    // whole-file plaintext buffer). The Blob is built only after the
    // generator completes, which is after the manifest authenticates.
    const parts: BlobPart[] = [];
    for await (const chunk of decryptChunks({
      ...ctx,
      urk,
      wrappedKey: base64ToBytes(file.wrappedKey),
      envelope,
    })) {
      parts.push(chunk.slice().buffer as ArrayBuffer);
    }
    const name = metadata.name || file.name;
    const mimeType = metadata.mimeType ?? file.mimeType;
    saveBlob(new Blob(parts, { type: mimeType }), name);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      0,
      "DECRYPT_FAILED",
      `Could not decrypt "${file.name}": ${errorMessage(error, "wrong key or damaged data")} Nothing was saved.`,
    );
  }
}
