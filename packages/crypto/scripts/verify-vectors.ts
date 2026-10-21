import committedVector from "../test/vectors/v1.json";
import {
  createRecoveryBlob,
  decryptFile,
  deriveKek,
  deriveMek,
  encryptBytes,
  encryptMetadata,
  openRecoveryBlob,
  wrapDek,
} from "../src/index";

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(value: string): Uint8Array {
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function nonceFactory(): () => Uint8Array {
  let i = 0;
  return () => {
    const out = new Uint8Array(24);
    out[0] = (i >> 8) & 0xff;
    out[1] = i & 0xff;
    out.fill(0x5a, 2);
    i += 1;
    return out;
  };
}

export interface VectorFieldResult {
  field: string;
  pass: boolean;
}

export interface VectorReport {
  /** Runtime that produced this report, e.g. "node" or "firefox". */
  runtime: string;
  /** Every recomputed output, hex-encoded; must match across runtimes exactly. */
  outputs: Record<string, string>;
  fields: VectorFieldResult[];
  pass: boolean;
}

/**
 * Recomputes every committed OCE1 v1 vector output from its committed inputs
 * and also decrypts the committed ciphertext. Used from Node and from a
 * bundled browser entry so both runtimes must agree byte-for-byte.
 */
export async function verifyVectors(runtime: string): Promise<VectorReport> {
  const committed = committedVector as {
    inputs: {
      urkHex: string;
      dekHex: string;
      fileIdHex: string;
      versionIdHex: string;
      keyEpoch: number;
      chunkSize: number;
      plaintextHex: string;
      metadata: { name: string; mimeType: string };
    };
    expected: {
      kekHex: string;
      mekHex: string;
      envelopeHex: string;
      wrappedKeyHex: string;
      metadataBlobHex: string;
    };
    recovery: { codeHex: string; nonceHex: string; blobHex: string; urkHex: string };
  };

  const { inputs, expected, recovery } = committed;
  const urk = fromHex(inputs.urkHex);
  const dek = fromHex(inputs.dekHex);
  const fileId = fromHex(inputs.fileIdHex);
  const versionId = fromHex(inputs.versionIdHex);
  const ctx = { fileId, versionId, keyEpoch: inputs.keyEpoch };
  const factory = nonceFactory();

  const envelope = await encryptBytes(fromHex(inputs.plaintextHex), {
    ...ctx,
    dek,
    chunkSize: inputs.chunkSize,
    nonceFactory: factory,
  });
  const wrappedKey = wrapDek(deriveKek(urk), dek, ctx, factory);
  const metadataBlob = encryptMetadata(deriveMek(urk), inputs.metadata, ctx, factory);
  const recoveryBlob = createRecoveryBlob(
    urk,
    fromHex(recovery.codeHex),
    inputs.keyEpoch,
    fromHex(recovery.nonceHex),
  );

  const decrypted = await decryptFile({
    urk,
    fileId,
    versionId,
    keyEpoch: inputs.keyEpoch,
    envelope: fromHex(expected.envelopeHex),
    wrappedKey: fromHex(expected.wrappedKeyHex),
    metadataBlob: fromHex(expected.metadataBlobHex),
  });
  const openedUrk = openRecoveryBlob(
    fromHex(recovery.blobHex),
    fromHex(recovery.codeHex),
    inputs.keyEpoch,
  );

  const fields: VectorFieldResult[] = [
    { field: "kek", pass: hex(deriveKek(urk)) === expected.kekHex },
    { field: "mek", pass: hex(deriveMek(urk)) === expected.mekHex },
    { field: "envelope", pass: hex(envelope) === expected.envelopeHex },
    { field: "wrappedKey", pass: hex(wrappedKey) === expected.wrappedKeyHex },
    { field: "metadataBlob", pass: hex(metadataBlob) === expected.metadataBlobHex },
    { field: "recoveryBlob", pass: hex(recoveryBlob) === recovery.blobHex },
    { field: "decryptPlaintext", pass: hex(decrypted.plaintext) === inputs.plaintextHex },
    {
      field: "decryptMetadata",
      pass: JSON.stringify(decrypted.metadata) === JSON.stringify(inputs.metadata),
    },
    { field: "openRecoveryUrk", pass: hex(openedUrk) === recovery.urkHex },
  ];

  const recomputed: Record<string, string> = {
    kek: hex(deriveKek(urk)),
    mek: hex(deriveMek(urk)),
    envelope: hex(envelope),
    wrappedKey: hex(wrappedKey),
    metadataBlob: hex(metadataBlob),
    recoveryBlob: hex(recoveryBlob),
  };

  return {
    runtime,
    outputs: recomputed,
    fields,
    pass: fields.every((f) => f.pass),
  };
}
