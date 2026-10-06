import type { FileDTO } from "@omnicloud/shared";
import { ApiError, apiErrorFromText, notifyUnauthorized } from "./client";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toFileDTO(value: Record<string, unknown>): FileDTO | null {
  const folderId = value["folderId"];
  if (
    typeof value["id"] === "string" &&
    typeof value["name"] === "string" &&
    typeof value["size"] === "number" &&
    typeof value["mimeType"] === "string" &&
    typeof value["sha256"] === "string" &&
    (folderId === null || typeof folderId === "string") &&
    typeof value["createdAt"] === "string" &&
    typeof value["updatedAt"] === "string"
  ) {
    return {
      id: value["id"],
      name: value["name"],
      size: value["size"],
      mimeType: value["mimeType"],
      sha256: value["sha256"],
      folderId,
      createdAt: value["createdAt"],
      updatedAt: value["updatedAt"],
    };
  }
  return null;
}

function parseUploadedFile(status: number, responseText: string): FileDTO {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(responseText) as unknown;
  } catch {
    // Handled by the shape check below.
  }
  if (isRecord(parsed) && isRecord(parsed["file"])) {
    const file = toFileDTO(parsed["file"]);
    if (file !== null) return file;
  }
  throw new ApiError(status, "UNKNOWN", "The server returned an unexpected response");
}

/**
 * Uploads a file via XMLHttpRequest (for upload progress) and resolves with
 * the created file record. Rejects with an ApiError on failure.
 */
export function uploadFile(
  file: File,
  folderId: string | null,
  onProgress?: (percent: number) => void,
): Promise<FileDTO> {
  return new Promise<FileDTO>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/files");

    const formData = new FormData();
    formData.append("file", file, file.name);
    if (folderId !== null) formData.append("folderId", folderId);

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && onProgress !== undefined) {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(parseUploadedFile(xhr.status, xhr.responseText));
        return;
      }
      if (xhr.status === 401) notifyUnauthorized();
      reject(apiErrorFromText(xhr.status, xhr.responseText));
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

    xhr.send(formData);
  });
}
