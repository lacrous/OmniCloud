import { createHash } from "node:crypto";
import type { FileUploadInput } from "../services/file-service";
import { sha256Hex } from "./hash";
import { sanitizeFileName } from "./filename";

/**
 * A digest of everything that determines what an upload creates: the sanitized
 * name, the target folder, the file being replaced, and the content. A replay
 * under the same operation id must present the same fingerprint, otherwise it is
 * a different request reusing a key.
 */
export function uploadRequestFingerprint(input: FileUploadInput): string {
  const contentHash = input.spooled?.sha256 ?? sha256Hex(input.data ?? Buffer.alloc(0));
  const canonical = JSON.stringify({
    name: sanitizeFileName(input.name),
    folderId: input.folderId ?? null,
    replaceFileId: input.replaceFileId ?? null,
    contentHash,
    size: input.spooled?.size ?? input.data?.byteLength ?? 0,
  });
  return createHash("sha256").update(canonical).digest("hex");
}
