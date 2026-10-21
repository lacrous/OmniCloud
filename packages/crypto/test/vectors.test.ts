import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { decryptFile, openRecoveryBlob } from "../src/index";
import { buildVector, fromHex, hex, type Oce1Vector } from "../scripts/vector-source";

const VECTOR_PATH = fileURLToPath(new URL("./vectors/v1.json", import.meta.url));

function readCommitted(): Oce1Vector {
  // The vector is committed. Its absence is a failure, not a reason to
  // regenerate it: a test that wrote the current output out would let a broken
  // implementation define its own baseline and pass.
  expect(
    existsSync(VECTOR_PATH),
    `the committed vector is missing; regenerate it deliberately with 'pnpm --filter @omnicloud/crypto vectors:write'`,
  ).toBe(true);
  return JSON.parse(readFileSync(VECTOR_PATH, "utf8")) as Oce1Vector;
}

describe("known-answer vectors", () => {
  test("reproduces the committed OCE1 v1 vector exactly", async () => {
    const committed = readCommitted();
    const vector = await buildVector();
    // Compared in full, so a change to any input or any output is caught —
    // not only the handful of fields the round trip below exercises.
    expect(vector).toEqual(committed);
  });

  test("committed vector decrypts and matches plaintext and metadata", async () => {
    const committed = readCommitted();
    const out = await decryptFile({
      urk: fromHex(committed.inputs.urkHex),
      fileId: fromHex(committed.inputs.fileIdHex),
      versionId: fromHex(committed.inputs.versionIdHex),
      keyEpoch: committed.inputs.keyEpoch,
      envelope: fromHex(committed.expected.envelopeHex),
      wrappedKey: fromHex(committed.expected.wrappedKeyHex),
      metadataBlob: fromHex(committed.expected.metadataBlobHex),
    });
    expect(hex(out.plaintext)).toBe(committed.inputs.plaintextHex);
    expect(out.metadata).toEqual(committed.inputs.metadata);
  });

  test("committed recovery blob opens to the committed URK", () => {
    const committed = readCommitted();
    const urk = openRecoveryBlob(
      fromHex(committed.recovery.blobHex),
      fromHex(committed.recovery.codeHex),
      0,
    );
    expect(hex(urk)).toBe(committed.recovery.urkHex);
    expect(hex(urk)).toBe(committed.inputs.urkHex);
  });
});
