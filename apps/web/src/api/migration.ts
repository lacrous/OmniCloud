import { decryptFile, encryptFile, readHeader, sha256Hex } from "@omnicloud/crypto";
import type { FileDTO, FileVersionDTO } from "@omnicloud/shared";
import { generateOpaqueName } from "@omnicloud/shared";
import { base64ToBytes, bytesToBase64, toArrayBuffer } from "../lib/bytes";
import { ApiError, api, errorMessage } from "./client";
import { fetchFileBytes } from "./download";
import { replaceEncryptedFile } from "./upload";

/**
 * Legacy → OCE1 migration for the web client (roadmap Phase 5, client side).
 *
 * Mirrors the SDK's `migrateFile`: inspect-first and idempotent. The plaintext
 * original is deleted only after the stored ciphertext has been verified, and
 * only when it is the single historical version. Multi-version files keep
 * plaintext history; the result reports how much remains. There is never a
 * plaintext fallback and never a delete before verification.
 */

export type MigrateStatus = "migrated" | "migrated_with_plaintext_history" | "already_migrated";

export interface MigrateResult {
  status: MigrateStatus;
  fileId: string;
  plaintextVersionsRemaining: number;
}

const OCE1 = "OCE1";
const OCE2 = "OCE2";

function plaintextCount(versions: FileVersionDTO[]): number {
  return versions.filter((v) => (v.encryptionFormat ?? null) === null).length;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Decrypts stored bytes, mapping any failure to MIGRATION_VERIFY_FAILED. */
async function verifyCandidate(fileId: string, urk: Uint8Array): Promise<Uint8Array> {
  try {
    const { file } = await api.files.get(fileId);
    if (file.encryptionFormat !== OCE1 || !file.wrappedKey || !file.metadataBlob) {
      throw new ApiError(
        0,
        "MIGRATION_UPLOAD_FAILED",
        `File ${fileId} was not stored as OCE1 after replace; the plaintext original is untouched`,
      );
    }
    const envelope = await fetchFileBytes(fileId);
    const header = readHeader(envelope);
    const restored = await decryptFile({
      urk,
      fileId: header.fileId,
      versionId: header.versionId,
      keyEpoch: header.keyEpoch,
      envelope,
      wrappedKey: base64ToBytes(file.wrappedKey),
      metadataBlob: base64ToBytes(file.metadataBlob),
    });
    return restored.plaintext;
  } catch (error) {
    if (error instanceof ApiError && error.code === "MIGRATION_UPLOAD_FAILED") throw error;
    throw new ApiError(
      0,
      "MIGRATION_VERIFY_FAILED",
      `Verification failed for ${fileId}: ${errorMessage(error, "decryption failed")}. Nothing was deleted; the plaintext original is untouched.`,
    );
  }
}

export async function migrateLegacyFile(fileId: string, urk: Uint8Array): Promise<MigrateResult> {
  const { file } = await api.files.get(fileId);
  let versions = (await api.files.versions(fileId)).versions;

  if (file.encryptionFormat === OCE1 && plaintextCount(versions) === 0) {
    return { status: "already_migrated", fileId, plaintextVersionsRemaining: 0 };
  }

  if (file.encryptionFormat !== OCE1) {
    // LEGACY: encrypt the current plaintext, replace, then verify the roundtrip.
    const plaintext = await fetchFileBytes(fileId);
    const encrypted = await encryptFile(plaintext, {
      urk,
      metadata: { name: file.name, mimeType: file.mimeType || undefined },
    });
    const uploaded = await replaceEncryptedFile(
      fileId,
      new Blob([toArrayBuffer(encrypted.envelope)]),
      file.name,
      {
        format: OCE1,
        wrappedKey: bytesToBase64(encrypted.wrappedKey),
        metadataBlob: bytesToBase64(encrypted.metadataBlob),
        keyEpoch: encrypted.keyEpoch,
      },
    );
    if (uploaded.encryptionFormat !== OCE1) {
      throw new ApiError(
        0,
        "MIGRATION_UPLOAD_FAILED",
        `File ${fileId} was not stored as OCE1 after replace; the plaintext original is untouched`,
      );
    }
    const candidate = await verifyCandidate(fileId, urk);
    if (!bytesEqual(candidate, plaintext)) {
      throw new ApiError(
        0,
        "MIGRATION_VERIFY_FAILED",
        `Verification failed for ${fileId}: decrypted content differs from the original. Nothing was deleted; the plaintext original is untouched.`,
      );
    }
  } else {
    // PENDING resume: verify the stored ciphertext against the recorded original hash.
    const legacy = versions
      .filter((v) => (v.encryptionFormat ?? null) === null)
      .sort((a, b) => b.versionNumber - a.versionNumber)[0];
    if (legacy === undefined) {
      throw new ApiError(
        0,
        "MIGRATION_STATE_INVALID",
        `File ${fileId} is OCE1 but no plaintext version remains to verify against`,
      );
    }
    const candidate = await verifyCandidate(fileId, urk);
    if (sha256Hex(candidate) !== legacy.sha256.toLowerCase()) {
      throw new ApiError(
        0,
        "MIGRATION_VERIFY_FAILED",
        `Verification failed for ${fileId}: stored ciphertext does not match the recorded original hash. Nothing was deleted.`,
      );
    }
  }

  // Cleanup: drop the plaintext predecessor only when it is the sole
  // historical version — the verified ciphertext is the same content, so no
  // version history is lost. Multi-version files keep their history.
  versions = (await api.files.versions(fileId)).versions;
  if (plaintextCount(versions) === 1 && versions.length === 2) {
    await api.files.pruneVersions(fileId, { policy: "KEEP_LATEST_N", count: 0 });
    versions = (await api.files.versions(fileId)).versions;
  }

  const remaining = plaintextCount(versions);
  return {
    status: remaining === 0 ? "migrated" : "migrated_with_plaintext_history",
    fileId,
    plaintextVersionsRemaining: remaining,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OCE1 → OCE2: hide the file's name
// ─────────────────────────────────────────────────────────────────────────────

export type OpaqueNameStatus = "migrated" | "already_migrated" | "failed";

export interface OpaqueNameResult {
  status: OpaqueNameStatus;
  fileId: string;
  /** The name the user knows the file by, which the server never sees. */
  name: string | null;
  error: string | null;
}

/**
 * Moves an encrypted file from OCE1 to OCE2, so the server stops seeing its
 * name.
 *
 * The content's ciphertext is not re-encrypted: it is already bound to the
 * envelope's own file and version ids, and those do not change. What changes
 * is the name the server stores — an opaque placeholder instead of the real
 * one — and the format recorded against the version. The metadata blob is
 * reused too, so the real name travels in exactly one encrypted place, as
 * before.
 *
 * The order is the verify-before-delete rule the legacy migration uses: the new
 * version is downloaded and decrypted back and compared with the original
 * before the old version's object is removed. A failure leaves the file as it
 * was.
 */
export async function migrateToOpaqueName(
  fileId: string,
  urk: Uint8Array,
): Promise<OpaqueNameResult> {
  const { file } = await api.files.get(fileId);
  if (file.encryptionFormat === OCE2) {
    return { status: "already_migrated", fileId, name: file.name, error: null };
  }
  if (file.encryptionFormat !== OCE1) {
    return {
      status: "failed",
      fileId,
      name: file.name,
      error: "Only an encrypted file can be moved to an opaque name; encrypt it first.",
    };
  }
  // The fields are optional on the record, so an absent one counts as missing.
  const wrappedKey = file.wrappedKey;
  const metadataBlob = file.metadataBlob;
  if (wrappedKey == null || metadataBlob == null) {
    return {
      status: "failed",
      fileId,
      name: file.name,
      error: "The file is missing its encryption metadata, so it cannot be moved.",
    };
  }

  const versions = (await api.files.versions(fileId)).versions;
  const current = versions.find((v) => v.id === file.currentVersionId) ?? versions[0];
  if (current === undefined) {
    return { status: "failed", fileId, name: file.name, error: "The file has no versions." };
  }

  let envelope: Uint8Array;
  let plaintext: Uint8Array;
  let realName: string;
  try {
    envelope = await fetchFileBytes(fileId);
    const header = readHeader(envelope);
    const restored = await decryptFile({
      urk,
      fileId: header.fileId,
      versionId: header.versionId,
      keyEpoch: header.keyEpoch,
      envelope,
      wrappedKey: base64ToBytes(wrappedKey),
      metadataBlob: base64ToBytes(metadataBlob),
    });
    plaintext = restored.plaintext;
    realName = restored.metadata.name ?? file.name;
  } catch (error) {
    return {
      status: "failed",
      fileId,
      name: file.name,
      error: `Could not read the file: ${errorMessage(error, "decryption failed")}. Nothing was changed.`,
    };
  }

  // The same ciphertext, the same wrapped key and metadata, under an opaque
  // name and the OCE2 format.
  const opaqueName = generateOpaqueName();
  let uploaded: FileDTO;
  try {
    uploaded = await replaceEncryptedFile(fileId, new Blob([toArrayBuffer(envelope)]), opaqueName, {
      format: OCE2,
      wrappedKey,
      metadataBlob,
      keyEpoch: file.keyEpoch ?? 0,
    });
  } catch (error) {
    return {
      status: "failed",
      fileId,
      name: realName,
      error: `Could not upload the opaque version: ${errorMessage(error, "upload failed")}. The original is untouched.`,
    };
  }

  // Verify before anything is removed: download the new version back, decrypt
  // it, and compare it with what was there before.
  try {
    const stored = await fetchFileBytes(fileId);
    const header = readHeader(stored);
    const restored = await decryptFile({
      urk,
      fileId: header.fileId,
      versionId: header.versionId,
      keyEpoch: header.keyEpoch,
      envelope: stored,
      // The new version carries the same wrapped key and metadata blob as the
      // one it replaces, so the ones already read from the file are the right
      // ones to verify against.
      wrappedKey: base64ToBytes(wrappedKey),
      metadataBlob: base64ToBytes(metadataBlob),
    });
    if (!bytesEqual(restored.plaintext, plaintext)) {
      throw new Error("the stored content differs from the original");
    }
  } catch (error) {
    return {
      status: "failed",
      fileId,
      name: realName,
      error: `Verification failed: ${errorMessage(error, "the content did not match")}. The original version was not removed.`,
    };
  }

  // Verified: the old version's object can go.
  if (current.id !== uploaded.currentVersionId) {
    try {
      await api.files.deleteVersion(fileId, current.id);
    } catch (error) {
      // The new version is good and current. The old object stays in the
      // channel and the reconciliation can find it, which is better than
      // removing a version the file still needs.
      return {
        status: "migrated",
        fileId,
        name: realName,
        error: `The file now has an opaque name, but the old version's object could not be removed: ${errorMessage(error, "unknown error")}`,
      };
    }
  }

  return { status: "migrated", fileId, name: realName, error: null };
}
