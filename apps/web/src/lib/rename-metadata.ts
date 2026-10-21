import { deriveMek, encryptMetadata } from "@omnicloud/crypto";
import { bytesToBase64, hexToBytes } from "./bytes";
import { getUrk } from "./crypto-session";
import { getNameIndex } from "./name-index-session";
import type { DriveItem } from "./drive";

/**
 * The name the server should store for a renamed file.
 *
 * A file whose name the server cannot read keeps the opaque placeholder it
 * already has: sending the real name back would undo the point of the format.
 * Everything else is renamed in the clear.
 */
export function serverSideNameFor(item: DriveItem, newName: string): string {
  if (item.file?.encryptionFormat === "OCE2") {
    return item.file?.name ?? newName;
  }
  return newName;
}

/**
 * The re-encrypted metadata blob for a renamed file.
 *
 * An encrypted file carries its name inside the metadata blob, and the blob is
 * authenticated against the *envelope's* file and version ids rather than the
 * server's. A rename therefore has to re-encrypt the metadata under the same
 * pair, and the server stores the result without interpreting it.
 *
 * Returns undefined when there is nothing to re-encrypt: a plaintext file, no
 * root key loaded, or an entry whose ids the client does not hold.
 */
export async function renamedMetadataBlob(
  item: DriveItem,
  newName: string,
): Promise<{ metadataBlob: string } | undefined> {
  const file = item.file;
  if (file === null) return undefined;
  if (file.encryptionFormat === null || file.encryptionFormat === undefined) return undefined;
  const urk = getUrk();
  if (urk === null) return undefined;

  const entry = getNameIndex().get(item.id);
  const fileId = entry?.cryptoFileId;
  const versionId = entry?.cryptoVersionId;
  if (fileId === undefined || versionId === undefined) return undefined;

  const blob = encryptMetadata(
    deriveMek(urk),
    { name: newName, mimeType: file.mimeType || undefined },
    {
      fileId: hexToBytes(fileId),
      versionId: hexToBytes(versionId),
      keyEpoch: file.keyEpoch ?? 0,
    },
  );
  return { metadataBlob: bytesToBase64(blob) };
}
