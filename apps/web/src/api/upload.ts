import type { FileDTO } from "@omnicloud/shared";
import { ApiError, apiErrorFromText, notifyUnauthorized } from "./client";

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
  if (isRecord(parsed) && isRecord(parsed["file"])) {
    const file = parsed["file"];
    if (typeof file["id"] === "string" && typeof file["name"] === "string") {
      return file as unknown as FileDTO;
    }
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
}

function xhrUpload(
  url: string,
  file: File,
  folderId: string | null,
  options: UploadOptions,
): Promise<FileDTO> {
  return new Promise<FileDTO>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);

    const formData = new FormData();
    formData.append("file", file, file.name);
    if (folderId !== null) formData.append("folderId", folderId);

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
      if (xhr.status === 401 && error.code !== "TELEGRAM_AUTH_REQUIRED") notifyUnauthorized();
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
export function uploadFile(
  file: File,
  folderId: string | null,
  options: UploadOptions = {},
): Promise<FileDTO> {
  return xhrUpload("/api/files", file, folderId, options);
}

/** Uploads a new version of an existing file via POST /api/files/:id/replace. */
export function replaceFile(
  file: File,
  fileId: string,
  options: UploadOptions = {},
): Promise<FileDTO> {
  return xhrUpload(`/api/files/${encodeURIComponent(fileId)}/replace`, file, null, options);
}
