import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SecretBox, SecretBoxError, deriveKey } from "../src/utils/secret-box";

const keyA = randomBytes(32);
const keyB = randomBytes(32);
const SESSION = "1BQANOTEpzaWdsaWNrIHNlc3Npb24gdmFsdWU=";

describe("SecretBox", () => {
  it("round-trips a session string", () => {
    const box = new SecretBox([{ version: 1, key: keyA }]);
    expect(box.open(box.seal(SESSION))).toBe(SESSION);
  });

  it("never includes the plaintext in the sealed envelope", () => {
    const box = new SecretBox([{ version: 1, key: keyA }]);
    expect(box.seal(SESSION)).not.toContain(SESSION);
    expect(box.seal(SESSION)).not.toContain(SESSION.slice(0, 20));
  });

  it("uses a fresh IV for every seal, so equal plaintexts differ", () => {
    const box = new SecretBox([{ version: 1, key: keyA }]);
    expect(box.seal(SESSION)).not.toBe(box.seal(SESSION));
  });

  it("rejects a tampered ciphertext even when its tag is the genuine one", () => {
    const box = new SecretBox([{ version: 1, key: keyA }]);
    const [v, iv, tag, ct] = box.seal(SESSION).split(":");
    const flipped = Buffer.from(ct!, "base64url");
    flipped[0] = flipped[0]! ^ 0xff;
    expect(() => box.open([v, iv, tag, flipped.toString("base64url")].join(":"))).toThrow(
      /authentication/,
    );
  });

  it("rejects a tampered authentication tag", () => {
    const box = new SecretBox([{ version: 1, key: keyA }]);
    const [v, iv, tag, ct] = box.seal(SESSION).split(":");
    const badTag = Buffer.from(tag!, "base64url");
    badTag[0] = badTag[0]! ^ 0xff;
    expect(() => box.open([v, iv, badTag.toString("base64url"), ct].join(":"))).toThrow(
      /authentication/,
    );
  });

  it("fails with the wrong key", () => {
    const sealed = new SecretBox([{ version: 1, key: keyA }]).seal(SESSION);
    const other = new SecretBox([{ version: 1, key: keyB }]);
    expect(() => other.open(sealed)).toThrow(SecretBoxError);
  });

  it("decrypts old key versions after rotation and seals with the newest", () => {
    const old = new SecretBox([{ version: 1, key: keyA }]).seal(SESSION);
    const rotated = new SecretBox([
      { version: 1, key: keyA },
      { version: 2, key: keyB },
    ]);
    expect(rotated.open(old)).toBe(SESSION);
    expect(rotated.seal(SESSION).startsWith("v2:")).toBe(true);
    expect(rotated.currentKeyVersion).toBe(2);
  });

  it("fails safely when a version has no key", () => {
    const sealed = new SecretBox([{ version: 2, key: keyB }]).seal(SESSION);
    expect(() => new SecretBox([{ version: 1, key: keyA }]).open(sealed)).toThrow(
      /No encryption key for version 2/,
    );
  });

  it("rejects malformed envelopes without echoing their content", () => {
    const box = new SecretBox([{ version: 1, key: keyA }]);
    expect(() => box.open("not-a-sealed-value")).toThrow(/Malformed/);
  });

  it("refuses to start without a key, or with a key of the wrong size", () => {
    expect(() => new SecretBox([])).toThrow();
    expect(() => new SecretBox([{ version: 1, key: Buffer.alloc(16) }])).toThrow(/32 bytes/);
  });
});

describe("deriveKey", () => {
  it("uses a 64-hex-character secret directly", () => {
    const hex = "ab".repeat(32);
    expect(deriveKey(hex).equals(Buffer.from(hex, "hex"))).toBe(true);
  });

  it("stretches a long passphrase to a 32-byte key, deterministically", () => {
    const passphrase = "a long enough passphrase for the key derivation";
    expect(deriveKey(passphrase).byteLength).toBe(32);
    expect(deriveKey(passphrase).equals(deriveKey(passphrase))).toBe(true);
  });

  it("rejects short secrets", () => {
    expect(() => deriveKey("short")).toThrow(/at least 32/);
  });
});
