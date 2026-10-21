import { encryptFile } from "@omnicloud/crypto";
import type { FileDTO } from "@omnicloud/shared";
import {
  ENCRYPTION_FORMAT_OCE1,
  ENCRYPTION_FORMAT_OCE2,
  generateOpaqueName,
  type EncryptionFormat,
} from "@omnicloud/shared";
import { getUrk, isEncryptUploadsEnabled } from "../lib/crypto-session";
import { isFileDTO } from "../lib/dto";
import { bytesToBase64, toArrayBuffer } from "../lib/bytes";
import {
  ApiError,
  apiErrorFromText,
  ERROR_CODES,
  errorMessage,
  notifyUnauthorized,
} from "./client";
import { STREAM_MIN_BYTES, encryptFileStreaming } from "./encrypt-stream";

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseFileResponse(status: number, responseText: string): FileDTO {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(responseText) as unknown;
  } catch {
    // Handled by the shape check below.
  }
  if (isRecord(parsed) && isRecord(parsed["file"]) && isFileDTO(parsed["file"])) {
    return parsed["file"];
  }
  throw new ApiError(status, "UNKNOWN", "The server returned an unexpected response");
}

/** Byte-level upload progress report. */
export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface UploadOptions {
  /** Receives byte counts and a clamped percentage. */
  onProgress?: (progress: UploadProgress) => void;
  /** Aborting this signal aborts the underlying XHR. */
  signal?: AbortSignal;
  /** Idempotency key: retries of the same upload send the same key. */
  operationId?: string;
  /**
   * The encrypted format to store the file in. `OCE1` is the default and
   * leaves the file's name visible to the server; `OCE2` hides it behind an
   * opaque placeholder and keeps the real name in the client's index.
   */
  format?: EncryptionFormat;
}

/** The encrypted format's text fields, sent before the file part. */
export interface UploadEncryption {
  /** Which format the file is stored in. */
  format: EncryptionFormat;
  /** Base64 wrapped DEK. */
  wrappedKey: string;
  /** Base64 encrypted metadata. */
  metadataBlob: string;
  keyEpoch: number;
}

export interface UploadResult {
  file: FileDTO;
  /** The ids the metadata blob is bound to, as hex. */
  cryptoFileId?: string;
  cryptoVersionId?: string;
}

interface UploadBody {
  /** Bytes sent as the "file" part: the File itself, or the encrypted envelope. */
  part: Blob;
  /**
   * Sent as the multipart filename, and stored by the server as the file's
   * name. For OCE1 this is the real name; for OCE2 it is an opaque
   * placeholder.
   */
  filename: string;
  /** The name the user knows the file by, which OCE2 keeps out of the server. */
  realName: string;
  /** The ids the metadata blob is bound to, as hex. */
  cryptoFileId?: string;
  cryptoVersionId?: string;
  /** Null for plaintext uploads. */
  encryption: UploadEncryption | null;
  /** Removes any temporary encryption spool once the upload settles. */
  dispose?: () => Promise<void>;
}

/**
 * When a URK is active and the encrypt-uploads preference is on, encrypts the
 * file before it leaves the browser. Any failure rejects — there is never a
 * plaintext fallback. Otherwise returns the original file untouched.
 */
async function prepareBody(file: File, format: EncryptionFormat): Promise<UploadBody> {
  const urk = getUrk();
  if (urk === null || !isEncryptUploadsEnabled()) {
    return { part: file, filename: file.name, realName: file.name, encryption: null };
  }
  // The name the server will store. Under OCE2 that is an opaque placeholder:
  // the real name travels only inside the encrypted metadata blob, and the
  // server has no way to read it.
  const filename = format === ENCRYPTION_FORMAT_OCE2 ? generateOpaqueName() : file.name;
  try {
    // Large files take the chunked path: slice-by-slice encryption with the
    // ciphertext spooled to OPFS (or Blob parts), so peak memory is bounded
    // by the slice size instead of the whole file.
    if (file.size >= STREAM_MIN_BYTES) {
      const streamed = await encryptFileStreaming(file, urk);
      return {
        part: streamed.envelope,
        filename,
        realName: file.name,
        cryptoFileId: streamed.fileIdHex,
        cryptoVersionId: streamed.versionIdHex,
        encryption: {
          format,
          wrappedKey: streamed.wrappedKey,
          metadataBlob: streamed.metadataBlob,
          keyEpoch: streamed.keyEpoch,
        },
        dispose: streamed.dispose,
      };
    }
    const plaintext = new Uint8Array(await file.arrayBuffer());
    const encrypted = await encryptFile(plaintext, {
      urk,
      metadata: { name: file.name, mimeType: file.type || undefined },
    });
    return {
      part: new Blob([toArrayBuffer(encrypted.envelope)], {
        type: file.type || "application/octet-stream",
      }),
      filename,
      realName: file.name,
      cryptoFileId: bytesToHex(encrypted.fileId),
      cryptoVersionId: bytesToHex(encrypted.versionId),
      encryption: {
        format,
        wrappedKey: bytesToBase64(encrypted.wrappedKey),
        metadataBlob: bytesToBase64(encrypted.metadataBlob),
        keyEpoch: encrypted.keyEpoch,
      },
    };
  } catch (error) {
    throw new ApiError(
      0,
      "ENCRYPTION_FAILED",
      `Could not encrypt "${file.name}": ${errorMessage(error, "encryption failed")}. Nothing was uploaded.`,
    );
  }
}

/** The multipart body an upload sends, shared by the XHR and fetch paths. */
function buildFormData(
  body: UploadBody,
  folderId: string | null,
  options: UploadOptions,
): FormData {
  const formData = new FormData();
  if (folderId !== null) formData.append("folderId", folderId);
  if (options.operationId) formData.append("operationId", options.operationId);
  if (body.encryption !== null) {
    formData.append("encryptionFormat", body.encryption.format);
    formData.append("wrappedKey", body.encryption.wrappedKey);
    formData.append("metadataBlob", body.encryption.metadataBlob);
    formData.append("keyEpoch", String(body.encryption.keyEpoch));
  }
  formData.append("file", body.part, body.filename);
  return formData;
}

/**
 * Uploads with fetch, for environments without an XMLHttpRequest.
 *
 * The XHR path is kept for the browser, where it reports upload progress and
 * supports aborting. This path cannot report progress, so the upload is
 * reported as a single step.
 */
async function fetchUpload(
  url: string,
  body: UploadBody,
  folderId: string | null,
  options: UploadOptions,
): Promise<FileDTO> {
  const formData = buildFormData(body, folderId, options);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      body: formData,
      signal: options.signal,
    });
  } catch {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "Could not reach the server. Check your connection and try again.",
    );
  }
  const text = await response.text();
  if (!response.ok) {
    const error = apiErrorFromText(response.status, text);
    if (response.status === 401 && error.code !== ERROR_CODES.TELEGRAM_AUTH_REQUIRED) {
      notifyUnauthorized();
    }
    throw error;
  }
  options.onProgress?.({
    loaded: body.part.size,
    total: body.part.size,
    percent: 100,
  });
  return parseFileResponse(response.status, text);
}

function xhrUpload(
  url: string,
  body: UploadBody,
  folderId: string | null,
  options: UploadOptions,
): Promise<FileDTO> {
  // Without an XMLHttpRequest there is no progress event to report, so the
  // upload goes through fetch instead.
  if (typeof XMLHttpRequest !== "function") {
    return fetchUpload(url, body, folderId, options);
  }
  return new Promise<FileDTO>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);

    const formData = buildFormData(body, folderId, options);

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
      options.onProgress?.({ loaded: event.loaded, total: event.total, percent });
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(parseFileResponse(xhr.status, xhr.responseText));
        } catch (error) {
          reject(error);
        }
        return;
      }
      const error = apiErrorFromText(xhr.status, xhr.responseText);
      if (xhr.status === 401 && error.code !== ERROR_CODES.TELEGRAM_AUTH_REQUIRED)
        notifyUnauthorized();
      reject(error);
    });
    xhr.addEventListener("error", () => {
      reject(
        new ApiError(
          0,
          "NETWORK_ERROR",
          "Could not reach the server. Check your connection and try again.",
        ),
      );
    });
    xhr.addEventListener("abort", () => {
      reject(new ApiError(0, "ABORTED", "Upload cancelled"));
    });

    const signal = options.signal;
    if (signal !== undefined) {
      if (signal.aborted) {
        reject(new ApiError(0, "ABORTED", "Upload cancelled"));
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }

    xhr.send(formData);
  });
}

/** Uploads a new file (optionally into `folderId`) and resolves with its record. */
export async function uploadFile(
  file: File,
  folderId: string | null,
  options: UploadOptions = {},
): Promise<UploadResult> {
  const body = await prepareBody(file, options.format ?? ENCRYPTION_FORMAT_OCE1);
  try {
    const uploaded = await xhrUpload("/api/files", body, folderId, options);
    return {
      file: uploaded,
      ...(body.cryptoFileId !== undefined ? { cryptoFileId: body.cryptoFileId } : {}),
      ...(body.cryptoVersionId !== undefined ? { cryptoVersionId: body.cryptoVersionId } : {}),
    };
  } finally {
    await body.dispose?.();
  }
}

/** Uploads a new version of an existing file via POST /api/files/:id/replace. */
export async function replaceFile(
  file: File,
  fileId: string,
  options: UploadOptions = {},
): Promise<UploadResult> {
  const body = await prepareBody(file, options.format ?? ENCRYPTION_FORMAT_OCE1);
  try {
    const uploaded = await xhrUpload(
      `/api/files/${encodeURIComponent(fileId)}/replace`,
      body,
      null,
      options,
    );
    return {
      file: uploaded,
      ...(body.cryptoFileId !== undefined ? { cryptoFileId: body.cryptoFileId } : {}),
      ...(body.cryptoVersionId !== undefined ? { cryptoVersionId: body.cryptoVersionId } : {}),
    };
  } finally {
    await body.dispose?.();
  }
}

/**
 * Sends already-encrypted envelope bytes as a new version. Used by migration
 * where verification must run against exactly these bytes — nothing is
 * re-encrypted here.
 */
export async function replaceEncryptedFile(
  fileId: string,
  envelope: Blob,
  filename: string,
  encryption: UploadEncryption,
  options: UploadOptions = {},
): Promise<FileDTO> {
  return xhrUpload(
    `/api/files/${encodeURIComponent(fileId)}/replace`,
    { part: envelope, filename, realName: filename, encryption },
    null,
    options,
  );
}
