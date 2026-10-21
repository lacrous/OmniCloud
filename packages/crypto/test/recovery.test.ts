import { describe, expect, test } from "vitest";
import {
  RECOVERY_BLOB_BYTES,
  RECOVERY_CODE_BYTES,
  AuthenticationError,
  createRecoveryBlob,
  formatRecoveryCode,
  generateRecoveryCode,
  generateUrk,
  openRecoveryBlob,
  parseRecoveryCode,
  UnsupportedFormatError,
  ValidationError,
} from "../src/index";

describe("recovery code format", () => {
  test("generates 256 bits formatted as eight hyphenated hex groups", () => {
    const { code, bytes } = generateRecoveryCode();
    expect(bytes).toHaveLength(RECOVERY_CODE_BYTES);
    expect(code).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{8}){7}$/);
  });

  test("parse accepts formatted, lowercase, uppercase, and pasted forms", () => {
    const { code, bytes } = generateRecoveryCode();
    expect(parseRecoveryCode(code)).toEqual(bytes);
    expect(parseRecoveryCode(code.toUpperCase())).toEqual(bytes);
    expect(parseRecoveryCode(code.replace(/-/g, ""))).toEqual(bytes);
    expect(parseRecoveryCode(`  ${code.replace(/-/g, " ")}  `)).toEqual(bytes);
  });

  test("parse rejects wrong lengths and non-hex input", () => {
    expect(() => parseRecoveryCode("abcd")).toThrow(ValidationError);
    expect(() => parseRecoveryCode("not a code at all")).toThrow(ValidationError);
    const { code } = generateRecoveryCode();
    expect(() => parseRecoveryCode(code.slice(0, -1))).toThrow(ValidationError);
    expect(() => parseRecoveryCode(code.replace(/.$/, "z"))).toThrow(ValidationError);
  });

  test("format and parse round-trip", () => {
    const { bytes } = generateRecoveryCode();
    expect(parseRecoveryCode(formatRecoveryCode(bytes))).toEqual(bytes);
  });
});

describe("recovery blob", () => {
  test("wraps and unwraps the URK", () => {
    const urk = generateUrk();
    const { bytes: code } = generateRecoveryCode();
    const blob = createRecoveryBlob(urk, code);
    expect(blob).toHaveLength(RECOVERY_BLOB_BYTES);
    expect(openRecoveryBlob(blob, code)).toEqual(urk);
  });

  test("wrong code fails to open", () => {
    const urk = generateUrk();
    const { bytes: code } = generateRecoveryCode();
    const blob = createRecoveryBlob(urk, code);
    const { bytes: wrong } = generateRecoveryCode();
    expect(() => openRecoveryBlob(blob, wrong)).toThrow(AuthenticationError);
  });

  test("tampered blob fails to open", () => {
    const urk = generateUrk();
    const { bytes: code } = generateRecoveryCode();
    const blob = createRecoveryBlob(urk, code);
    const flipped = blob.slice();
    flipped[flipped.length - 1]! ^= 0x80;
    expect(() => openRecoveryBlob(flipped, code)).toThrow(AuthenticationError);
    const badNonce = blob.slice();
    badNonce[0]! ^= 0x01;
    expect(() => openRecoveryBlob(badNonce, code)).toThrow(AuthenticationError);
  });

  test("wrong-length blob is rejected before decryption", () => {
    const { bytes: code } = generateRecoveryCode();
    expect(() => openRecoveryBlob(new Uint8Array(10), code)).toThrow(UnsupportedFormatError);
    expect(() => openRecoveryBlob(new Uint8Array(RECOVERY_BLOB_BYTES + 1), code)).toThrow(
      UnsupportedFormatError,
    );
  });

  test("distinct codes produce distinct keys for the same URK", () => {
    const urk = generateUrk();
    const a = generateRecoveryCode();
    const b = generateRecoveryCode();
    const blobA = createRecoveryBlob(urk, a.bytes);
    expect(() => openRecoveryBlob(blobA, b.bytes)).toThrow(AuthenticationError);
    expect(a.bytes).not.toEqual(b.bytes);
  });

  test("blob is deterministic in length regardless of URK", () => {
    const { bytes: code } = generateRecoveryCode();
    expect(createRecoveryBlob(generateUrk(), code)).toHaveLength(RECOVERY_BLOB_BYTES);
    expect(createRecoveryBlob(generateUrk(), code)).toHaveLength(RECOVERY_BLOB_BYTES);
  });
});
