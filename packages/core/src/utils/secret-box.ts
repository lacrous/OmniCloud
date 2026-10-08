import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { ValidationError } from "../errors";

/**
 * Authenticated encryption for values stored at rest (Telegram session strings).
 *
 * AES-256-GCM with a fresh random 96-bit IV per seal. The stored envelope is
 * `v<keyVersion>:<iv>:<tag>:<ciphertext>` (base64url), so a key can be rotated
 * later by keeping old versions available for decryption.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

export interface SecretBoxKey {
  version: number;
  key: Buffer;
}

export class SecretBox {
  private readonly keys: Map<number, Buffer>;
  private readonly currentVersion: number;

  /**
   * @param keys key versions available for decryption; the highest version is
   *   used for new seals.
   */
  constructor(keys: SecretBoxKey[]) {
    if (keys.length === 0) {
      throw new ValidationError("At least one encryption key is required");
    }
    this.keys = new Map();
    for (const { version, key } of keys) {
      if (key.byteLength !== KEY_BYTES) {
        throw new ValidationError(`Encryption key version ${version} must be 32 bytes`);
      }
      this.keys.set(version, key);
    }
    this.currentVersion = Math.max(...this.keys.keys());
  }

  seal(plaintext: string): string {
    const key = this.keys.get(this.currentVersion)!;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      `v${this.currentVersion}`,
      iv.toString("base64url"),
      tag.toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(":");
  }

  open(envelope: string): string {
    const parts = envelope.split(":");
    if (parts.length !== 4 || !parts[0]!.startsWith("v")) {
      throw new SecretBoxError("Malformed sealed value");
    }
    const version = Number(parts[0]!.slice(1));
    const key = this.keys.get(version);
    if (!key) throw new SecretBoxError(`No encryption key for version ${version}`);

    try {
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(parts[1]!, "base64url"));
      decipher.setAuthTag(Buffer.from(parts[2]!, "base64url"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(parts[3]!, "base64url")),
        decipher.final(),
      ]);
      return plaintext.toString("utf8");
    } catch {
      throw new SecretBoxError("Sealed value failed authentication");
    }
  }

  get currentKeyVersion(): number {
    return this.currentVersion;
  }
}

/** Raised for corrupt, tampered, or undecryptable values. Never includes the value itself. */
export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretBoxError";
  }
}

/** Fixed salt: the same secret must derive the same key on every start. */
const KDF_SALT = "omnicloud-secret-box-v1";

/**
 * Derives a 256-bit key from an operator-supplied secret. Accepts either a
 * 64-character hex string (preferred: `openssl rand -hex 32`, used as-is) or a
 * passphrase of at least 32 characters, stretched with scrypt so a weak
 * passphrase is expensive to brute-force.
 */
export function deriveKey(secret: string): Buffer {
  if (/^[0-9a-f]{64}$/i.test(secret)) return Buffer.from(secret, "hex");
  if (secret.length < 32) {
    throw new ValidationError(
      "The encryption key must be 64 hex characters or at least 32 characters",
    );
  }
  return scryptSync(secret, KDF_SALT, KEY_BYTES);
}
