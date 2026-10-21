import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { randomBytes } from "@noble/hashes/utils";
import { AuthenticationError, UnsupportedFormatError, ValidationError } from "./errors";
import { KEY_BYTES, assertKeyMaterial } from "./keys";
import { KEY_EPOCH_V1, NONCE_BYTES, SUITE, TAG_BYTES } from "./envelope";

/**
 * The OCE2 client-side name index.
 *
 * The index holds the real name, type and description of every file the client
 * knows about. It is the only place those live once a file is uploaded under
 * an opaque name, and it is encrypted with a key derived from the user's root
 * key, so the copy on disk reveals nothing on its own.
 *
 * Normative detail lives in docs/security/encryption-protocol-v2.md.
 */

export const OCE2_MAGIC = new Uint8Array([0x4f, 0x43, 0x45, 0x32]); // "OCE2"
export const INDEX_CONTAINER_VERSION = 2;
export const INDEX_AAD_TYPE = 0x06;
export const INDEX_KEY_INFO = "omnicloud/e2ee/v2/index";
export const INDEX_HKDF_SALT = "omnicloud-e2ee-v2";

const HKDF_INFO = INDEX_KEY_INFO;

/** One file's entry in the index. */
export interface IndexEntry {
  /** The server's file id. */
  id: string;
  /** The real file name, which the server never sees. */
  name: string;
  /**
   * The ids the metadata blob is bound to, as hex. The blob is authenticated
   * against the envelope's own file and version ids, not the server's, so a
   * rename has to re-encrypt it under the same pair.
   */
  cryptoFileId?: string;
  cryptoVersionId?: string;
  mimeType: string | null;
  description: string | null;
  size: number;
  folderId: string | null;
  starred: boolean;
  trashed: boolean;
  versionCount: number;
  createdAt: string;
  updatedAt: string;
}

/** The key that encrypts the index, derived from the user's root key. */
export function deriveIndexKey(urk: Uint8Array): Uint8Array {
  assertKeyMaterial("urk", urk);
  return hkdf(
    sha256,
    urk,
    new TextEncoder().encode(INDEX_HKDF_SALT),
    new TextEncoder().encode(HKDF_INFO),
    KEY_BYTES,
  );
}

function indexAad(keyEpoch: number): Uint8Array {
  const epoch = new Uint8Array(4);
  new DataView(epoch.buffer).setUint32(0, keyEpoch, false);
  const out = new Uint8Array(OCE2_MAGIC.length + 1 + 1 + epoch.length + 1);
  out.set(OCE2_MAGIC, 0);
  out[OCE2_MAGIC.length] = INDEX_CONTAINER_VERSION;
  out[OCE2_MAGIC.length + 1] = SUITE;
  out.set(epoch, OCE2_MAGIC.length + 2);
  out[out.length - 1] = INDEX_AAD_TYPE;
  return out;
}

/**
 * Serialises index entries to the canonical bytes the container encrypts.
 *
 * Canonical means: the object keys of an entry in lexicographic order, no
 * insignificant whitespace, and absent optional fields omitted rather than
 * written as null — except `folderId` and `description`, which are always
 * present. Two clients holding the same index must produce the same bytes.
 */
export function canonicalIndexJson(entries: readonly IndexEntry[]): Uint8Array {
  const parts = entries.map((entry) => {
    // Lexicographic order of the entry's keys.
    const fields: string[] = [];
    fields.push(`"createdAt":${JSON.stringify(entry.createdAt)}`);
    if (entry.cryptoFileId !== undefined) {
      fields.push(`"cryptoFileId":${JSON.stringify(entry.cryptoFileId)}`);
    }
    if (entry.cryptoVersionId !== undefined) {
      fields.push(`"cryptoVersionId":${JSON.stringify(entry.cryptoVersionId)}`);
    }
    fields.push(`"description":${JSON.stringify(entry.description)}`);
    fields.push(`"folderId":${JSON.stringify(entry.folderId)}`);
    fields.push(`"id":${JSON.stringify(entry.id)}`);
    fields.push(`"mimeType":${JSON.stringify(entry.mimeType)}`);
    fields.push(`"name":${JSON.stringify(entry.name)}`);
    fields.push(`"size":${JSON.stringify(entry.size)}`);
    fields.push(`"starred":${JSON.stringify(entry.starred)}`);
    fields.push(`"trashed":${JSON.stringify(entry.trashed)}`);
    fields.push(`"updatedAt":${JSON.stringify(entry.updatedAt)}`);
    fields.push(`"versionCount":${JSON.stringify(entry.versionCount)}`);
    return `{${fields.join(",")}}`;
  });
  return new TextEncoder().encode(`{"entries":[${parts.join(",")}]}`);
}

/**
 * Encrypts index entries into a container.
 *
 * The result is `nonce(24) || ciphertext || tag(16)`, and the nonce is never
 * reused with the same key.
 */
export function createIndexContainer(
  urk: Uint8Array,
  entries: readonly IndexEntry[],
  keyEpoch: number = KEY_EPOCH_V1,
  nonce?: Uint8Array,
): Uint8Array {
  const key = deriveIndexKey(urk);
  const actualNonce = nonce ?? randomBytes(NONCE_BYTES);
  if (actualNonce.length !== NONCE_BYTES) {
    throw new ValidationError(`index nonce must be ${NONCE_BYTES} bytes`);
  }
  const sealed = xchacha20poly1305(key, actualNonce, indexAad(keyEpoch)).encrypt(
    canonicalIndexJson(entries),
  );
  const out = new Uint8Array(NONCE_BYTES + sealed.length);
  out.set(actualNonce, 0);
  out.set(sealed, NONCE_BYTES);
  return out;
}

/**
 * Opens a container and returns its entries.
 *
 * Throws `AuthenticationError` when the container was sealed under a different
 * root key, or when it has been altered.
 */
export function openIndexContainer(
  urk: Uint8Array,
  container: Uint8Array,
  keyEpoch: number = KEY_EPOCH_V1,
): IndexEntry[] {
  if (!(container instanceof Uint8Array) || container.length < NONCE_BYTES + TAG_BYTES) {
    throw new UnsupportedFormatError(
      `index container is too short: ${container?.length ?? "none"} bytes`,
    );
  }
  const key = deriveIndexKey(urk);
  let plaintext: Uint8Array;
  try {
    plaintext = xchacha20poly1305(
      key,
      container.subarray(0, NONCE_BYTES),
      indexAad(keyEpoch),
    ).decrypt(container.subarray(NONCE_BYTES));
  } catch {
    throw new AuthenticationError(
      "the index could not be opened: wrong key, or the stored index is damaged",
    );
  }
  return parseIndexJson(plaintext);
}

/** Parses the canonical bytes of an index into entries. */
export function parseIndexJson(bytes: Uint8Array): IndexEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new UnsupportedFormatError("the index is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new UnsupportedFormatError("the index is not an object");
  }
  const entries = (parsed as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) {
    throw new UnsupportedFormatError("the index has no entries array");
  }
  return entries.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      throw new UnsupportedFormatError("an index entry is not an object");
    }
    const record = entry as Record<string, unknown>;
    if (typeof record["id"] !== "string" || typeof record["name"] !== "string") {
      throw new UnsupportedFormatError("an index entry is missing its id or name");
    }
    return {
      id: record["id"],
      name: record["name"],
      ...(typeof record["cryptoFileId"] === "string"
        ? { cryptoFileId: record["cryptoFileId"] }
        : {}),
      ...(typeof record["cryptoVersionId"] === "string"
        ? { cryptoVersionId: record["cryptoVersionId"] }
        : {}),
      mimeType: typeof record["mimeType"] === "string" ? record["mimeType"] : null,
      description: typeof record["description"] === "string" ? record["description"] : null,
      size: typeof record["size"] === "number" ? record["size"] : 0,
      folderId: typeof record["folderId"] === "string" ? record["folderId"] : null,
      starred: record["starred"] === true,
      trashed: record["trashed"] === true,
      versionCount: typeof record["versionCount"] === "number" ? record["versionCount"] : 0,
      createdAt: typeof record["createdAt"] === "string" ? record["createdAt"] : "",
      updatedAt: typeof record["updatedAt"] === "string" ? record["updatedAt"] : "",
    };
  });
}
