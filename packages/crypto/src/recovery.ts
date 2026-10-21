import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { randomBytes } from "@noble/hashes/utils";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { AuthenticationError, UnsupportedFormatError, ValidationError } from "./errors";
import { KEY_BYTES, assertKeyMaterial } from "./keys";
import { KEY_EPOCH_V1, NONCE_BYTES, SUITE, TAG_BYTES, MAGIC } from "./envelope";

/**
 * Provisional OCE1 recovery container.
 *
 * A high-entropy recovery code (256 bits, user-held) derives a recovery key
 * that wraps the user's root key into an opaque blob the server can store but
 * never open. Normative detail lives in docs/security/recovery-and-device-revocation.md.
 */

export const RECOVERY_BLOB_BYTES = NONCE_BYTES + KEY_BYTES + TAG_BYTES; // 72
export const RECOVERY_CODE_BYTES = 32;
const AAD_TYPE_RECOVERY = 0x04;
const HKDF_INFO_RECOVERY = "omnicloud/e2ee/v1/recovery";

function recoveryAad(keyEpoch: number): Uint8Array {
  const epoch = new Uint8Array(4);
  new DataView(epoch.buffer).setUint32(0, keyEpoch, false);
  const out = new Uint8Array(MAGIC.length + 2 + 4 + 1);
  out.set(MAGIC, 0);
  out[MAGIC.length] = 1; // format version
  out[MAGIC.length + 1] = SUITE; // suite
  out.set(epoch, MAGIC.length + 2);
  out[out.length - 1] = AAD_TYPE_RECOVERY;
  return out;
}

/** 256-bit recovery code formatted as eight groups of eight hex characters. */
export function generateRecoveryCode(): { code: string; bytes: Uint8Array } {
  const bytes = randomBytes(RECOVERY_CODE_BYTES);
  return { code: formatRecoveryCode(bytes), bytes };
}

export function formatRecoveryCode(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array) || bytes.length !== RECOVERY_CODE_BYTES) {
    throw new ValidationError(`recovery code must be ${RECOVERY_CODE_BYTES} bytes`);
  }
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return (hex.match(/.{8}/g) ?? []).join("-");
}

/** Accepts the formatted code or any pasted form; requires exactly 64 hex chars. */
export function parseRecoveryCode(input: string): Uint8Array {
  if (typeof input !== "string") throw new ValidationError("recovery code is required");
  const hex = input.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  if (hex.length !== RECOVERY_CODE_BYTES * 2) {
    throw new ValidationError(
      `recovery code must contain ${RECOVERY_CODE_BYTES * 2} hex characters`,
    );
  }
  const out = new Uint8Array(RECOVERY_CODE_BYTES);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function deriveRecoveryKey(codeBytes: Uint8Array): Uint8Array {
  assertKeyMaterial("recovery code", codeBytes, RECOVERY_CODE_BYTES);
  return hkdf(
    sha256,
    codeBytes,
    new TextEncoder().encode("omnicloud-e2ee-v1"),
    new TextEncoder().encode(HKDF_INFO_RECOVERY),
    KEY_BYTES,
  );
}

/** Wraps the URK under the recovery key. Returns exactly RECOVERY_BLOB_BYTES. */
export function createRecoveryBlob(
  urk: Uint8Array,
  codeBytes: Uint8Array,
  keyEpoch: number = KEY_EPOCH_V1,
  nonce?: Uint8Array,
): Uint8Array {
  assertKeyMaterial("urk", urk);
  const key = deriveRecoveryKey(codeBytes);
  const actualNonce = nonce ?? randomBytes(NONCE_BYTES);
  if (actualNonce.length !== NONCE_BYTES) {
    throw new ValidationError(`recovery nonce must be ${NONCE_BYTES} bytes`);
  }
  const sealed = xchacha20poly1305(key, actualNonce, recoveryAad(keyEpoch)).encrypt(urk);
  const out = new Uint8Array(NONCE_BYTES + sealed.length);
  out.set(actualNonce, 0);
  out.set(sealed, NONCE_BYTES);
  if (out.length !== RECOVERY_BLOB_BYTES) {
    throw new ValidationError("recovery blob has unexpected length");
  }
  return out;
}

/** Opens a recovery blob; throws AuthenticationError for a wrong code or tampered blob. */
export function openRecoveryBlob(
  blob: Uint8Array,
  codeBytes: Uint8Array,
  keyEpoch: number = KEY_EPOCH_V1,
): Uint8Array {
  if (!(blob instanceof Uint8Array) || blob.length !== RECOVERY_BLOB_BYTES) {
    throw new UnsupportedFormatError(
      `recovery blob must be ${RECOVERY_BLOB_BYTES} bytes, got ${blob?.length ?? "none"}`,
    );
  }
  const key = deriveRecoveryKey(codeBytes);
  try {
    const urk = xchacha20poly1305(
      key,
      blob.subarray(0, NONCE_BYTES),
      recoveryAad(keyEpoch),
    ).decrypt(blob.subarray(NONCE_BYTES));
    if (urk.length !== KEY_BYTES) throw new AuthenticationError("recovery failed");
    return urk;
  } catch (error) {
    if (error instanceof AuthenticationError) throw error;
    throw new AuthenticationError("recovery code is incorrect or the code record is damaged");
  }
}
