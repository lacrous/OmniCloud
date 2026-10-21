import { describe, expect, test } from "vitest";
import {
  AuthenticationError,
  BindingError,
  ManifestError,
  TrailingDataError,
  UnsupportedFormatError,
  ValidationError,
  decryptBytes,
  decryptFile,
  decryptMetadata,
  deriveKek,
  deriveMek,
  encryptBytes,
  encryptFile,
  encryptMetadata,
  generateDek,
  generateId,
  generateUrk,
  readHeader,
  wrapDek,
} from "../src/index";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

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

const URK = new Uint8Array(32).fill(0x11);
const FILE_ID = new Uint8Array(16).fill(0xa1);
const VERSION_ID = new Uint8Array(16).fill(0xb2);

async function roundtrip(plaintext: Uint8Array, chunkSize?: number) {
  const version = await encryptFile(plaintext, {
    urk: URK,
    metadata: { name: "x.bin", mimeType: "application/octet-stream" },
    fileId: FILE_ID,
    versionId: VERSION_ID,
    chunkSize,
  });
  const out = await decryptFile({
    urk: URK,
    fileId: FILE_ID,
    versionId: VERSION_ID,
    envelope: version.envelope,
    wrappedKey: version.wrappedKey,
    metadataBlob: version.metadataBlob,
  });
  expect(dec(out.plaintext)).toBe(dec(plaintext));
  expect(out.metadata.name).toBe("x.bin");
  return version;
}

describe("roundtrip", () => {
  test("empty file uses one empty data record plus manifest", async () => {
    const v = await roundtrip(new Uint8Array(0), 64);
    const header = readHeader(v.envelope);
    expect(header.version).toBe(1);
    expect(header.suite).toBe(1);
    expect(header.keyEpoch).toBe(0);
    expect(header.fileId).toEqual(FILE_ID);
    expect(header.versionId).toEqual(VERSION_ID);
  });

  test("small file", async () => {
    await roundtrip(enc("hello omnicloud e2ee"), 64);
  });

  test("exactly one full chunk", async () => {
    await roundtrip(new Uint8Array(64).fill(7), 64);
  });

  test("chunk plus one byte", async () => {
    await roundtrip(new Uint8Array(65).fill(7), 64);
  });

  test("multiple chunks with metadata", async () => {
    const plaintext = new Uint8Array(200);
    for (let i = 0; i < plaintext.length; i++) plaintext[i] = (i * 13) & 0xff;
    const v = await encryptFile(plaintext, {
      urk: URK,
      metadata: { name: "report.pdf", mimeType: "application/pdf", description: "q3" },
      fileId: FILE_ID,
      versionId: VERSION_ID,
      chunkSize: 64,
    });
    const out = await decryptFile({
      urk: URK,
      fileId: FILE_ID,
      versionId: VERSION_ID,
      envelope: v.envelope,
      wrappedKey: v.wrappedKey,
      metadataBlob: v.metadataBlob,
    });
    expect(out.plaintext).toEqual(plaintext);
    expect(out.metadata).toEqual({
      name: "report.pdf",
      mimeType: "application/pdf",
      description: "q3",
    });
  });

  test("default chunk size works for multi-mib plaintext", async () => {
    const plaintext = new Uint8Array(5 * 1024 * 1024 + 17);
    for (let i = 0; i < plaintext.length; i += 4096) plaintext[i] = i & 0xff;
    const out = await decryptFile({
      urk: URK,
      // encryptFile returns the file and version ids it used, so they are
      // spread in rather than repeated here.
      ...(await encryptFile(plaintext, {
        urk: URK,
        metadata: { name: "big.bin" },
        fileId: FILE_ID,
        versionId: VERSION_ID,
      })),
    });
    expect(Buffer.from(out.plaintext).equals(Buffer.from(plaintext))).toBe(true);
  }, 60000);
});

describe("keys", () => {
  test("kek and mek are domain separated", () => {
    expect(deriveKek(URK)).not.toEqual(deriveMek(URK));
    expect(deriveKek(URK)).toHaveLength(32);
  });

  test("generators produce independent material", () => {
    expect(generateUrk()).not.toEqual(generateUrk());
    expect(generateDek()).toHaveLength(32);
    expect(generateId()).toHaveLength(16);
  });

  test("invalid urk length rejected", () => {
    expect(() => deriveKek(new Uint8Array(16))).toThrow(ValidationError);
  });
});

describe("metadata", () => {
  test("roundtrip without optional fields", () => {
    const mek = deriveMek(URK);
    const ctx = { fileId: FILE_ID, versionId: VERSION_ID };
    const blob = encryptMetadata(mek, { name: "a.txt" }, ctx);
    expect(decryptMetadata(mek, blob, ctx)).toEqual({ name: "a.txt" });
  });

  test("wrong mek fails", () => {
    const ctx = { fileId: FILE_ID, versionId: VERSION_ID };
    const blob = encryptMetadata(deriveMek(URK), { name: "a.txt" }, ctx);
    expect(() => decryptMetadata(new Uint8Array(32).fill(9), blob, ctx)).toThrow(
      AuthenticationError,
    );
  });

  test("empty name rejected", () => {
    const mek = deriveMek(URK);
    expect(() =>
      encryptMetadata(mek, { name: "" }, { fileId: FILE_ID, versionId: VERSION_ID }),
    ).toThrow(ValidationError);
  });
});

function flipLastByte(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  out[out.length - 1]! ^= 0x80;
  return out;
}

function parseRecords(envelope: Uint8Array): { header: Uint8Array; records: Uint8Array[] } {
  const header = envelope.slice(0, 48);
  const records: Uint8Array[] = [];
  let offset = 48;
  while (offset < envelope.length) {
    const len = new DataView(envelope.buffer, envelope.byteOffset + offset, 4).getUint32(0, false);
    offset += 4;
    records.push(envelope.slice(offset, offset + 24 + len));
    offset += 24 + len;
  }
  return { header, records };
}

function join(header: Uint8Array, records: Uint8Array[]): Uint8Array {
  let total = header.length;
  for (const r of records) total += 4 + r.length;
  const out = new Uint8Array(total);
  out.set(header, 0);
  let offset = header.length;
  for (const r of records) {
    new DataView(out.buffer, offset, 4).setUint32(0, r.length - 24, false);
    out.set(r, offset + 4);
    offset += 4 + r.length;
  }
  return out;
}

async function prepared() {
  const dek = generateDek();
  const ctx = { fileId: FILE_ID, versionId: VERSION_ID, keyEpoch: 0 };
  const plaintext = enc("alpha bravo charlie delta echo foxtrot golf hotel india juliet");
  const envelope = await encryptBytes(plaintext, {
    ...ctx,
    dek,
    chunkSize: 16,
    nonceFactory: nonceFactory(),
  });
  const wrappedKey = wrapDek(deriveKek(URK), dek, ctx, nonceFactory());
  const metadataBlob = encryptMetadata(deriveMek(URK), { name: "n.txt" }, ctx, nonceFactory());
  return { plaintext, envelope, wrappedKey, metadataBlob, ctx };
}

async function expectDecryptFailure(envelope: Uint8Array, wrappedKey: Uint8Array, error: unknown) {
  await expect(
    decryptBytes({ urk: URK, fileId: FILE_ID, versionId: VERSION_ID, envelope, wrappedKey }),
  ).rejects.toThrow(error as new (...args: never[]) => Error);
}

describe("negative cases", () => {
  test("wrong urk cannot unwrap dek", async () => {
    const p = await prepared();
    await expect(
      decryptBytes({
        urk: new Uint8Array(32).fill(0x99),
        fileId: FILE_ID,
        versionId: VERSION_ID,
        envelope: p.envelope,
        wrappedKey: p.wrappedKey,
      }),
    ).rejects.toThrow(AuthenticationError);
  });

  test("fileId binding mismatch", async () => {
    const p = await prepared();
    await expect(
      decryptBytes({
        urk: URK,
        fileId: generateId(),
        versionId: VERSION_ID,
        envelope: p.envelope,
        wrappedKey: p.wrappedKey,
      }),
    ).rejects.toThrow(BindingError);
  });

  test("key epoch mismatch", async () => {
    const p = await prepared();
    await expect(
      decryptBytes({
        urk: URK,
        fileId: FILE_ID,
        versionId: VERSION_ID,
        keyEpoch: 1,
        envelope: p.envelope,
        wrappedKey: p.wrappedKey,
      }),
    ).rejects.toThrow(BindingError);
  });

  test("bad magic", async () => {
    const p = await prepared();
    const bad = p.envelope.slice();
    bad[0]! ^= 0xff;
    await expectDecryptFailure(bad, p.wrappedKey, UnsupportedFormatError);
  });

  test("unsupported version", async () => {
    const p = await prepared();
    const bad = p.envelope.slice();
    bad[4] = 2;
    await expectDecryptFailure(bad, p.wrappedKey, UnsupportedFormatError);
  });

  test("nonzero flags rejected", async () => {
    const p = await prepared();
    const bad = p.envelope.slice();
    bad[6] = 1;
    await expectDecryptFailure(bad, p.wrappedKey, UnsupportedFormatError);
  });

  test("tampered data ciphertext", async () => {
    const p = await prepared();
    const bad = p.envelope.slice();
    bad[48 + 4 + 24 + 3]! ^= 0x01;
    await expectDecryptFailure(bad, p.wrappedKey, AuthenticationError);
  });

  test("tampered manifest record", async () => {
    const p = await prepared();
    const bad = flipLastByte(p.envelope);
    await expectDecryptFailure(bad, p.wrappedKey, AuthenticationError);
  });

  test("reordered records", async () => {
    const p = await prepared();
    const { header, records } = parseRecords(p.envelope);
    [records[0], records[1]] = [records[1]!, records[0]!];
    await expectDecryptFailure(join(header, records), p.wrappedKey, AuthenticationError);
  });

  test("duplicated record", async () => {
    const p = await prepared();
    const { header, records } = parseRecords(p.envelope);
    records.splice(1, 0, records[0]!);
    await expectDecryptFailure(join(header, records), p.wrappedKey, AuthenticationError);
  });

  test("missing manifest", async () => {
    const p = await prepared();
    const { header, records } = parseRecords(p.envelope);
    records.pop();
    await expectDecryptFailure(join(header, records), p.wrappedKey, ManifestError);
  });

  test("trailing bytes after manifest", async () => {
    const p = await prepared();
    const { header, records } = parseRecords(p.envelope);
    records.push(records[0]!);
    await expectDecryptFailure(join(header, records), p.wrappedKey, TrailingDataError);
  });

  test("truncated final bytes", async () => {
    const p = await prepared();
    await expectDecryptFailure(
      p.envelope.slice(0, p.envelope.length - 3),
      p.wrappedKey,
      UnsupportedFormatError,
    );
  });

  test("zero-length record rejected", async () => {
    const p = await prepared();
    const { header, records } = parseRecords(p.envelope);
    records[0] = new Uint8Array(0);
    await expectDecryptFailure(join(header, records), p.wrappedKey, UnsupportedFormatError);
  });

  test("oversized record length rejected", async () => {
    const p = await prepared();
    const { header, records } = parseRecords(p.envelope);
    const bad = join(header, records);
    new DataView(bad.buffer, 48, 4).setUint32(0, 100 * 1024 * 1024, false);
    await expectDecryptFailure(bad, p.wrappedKey, UnsupportedFormatError);
  });

  test("wrappedKey tampering", async () => {
    const p = await prepared();
    await expectDecryptFailure(p.envelope, flipLastByte(p.wrappedKey), AuthenticationError);
  });
});

describe("streaming", () => {
  test("chunked async source produces byte-identical envelope to one-shot", async () => {
    const dek = generateDek();
    const ctx = { fileId: FILE_ID, versionId: VERSION_ID };
    const plaintext = new Uint8Array(150);
    for (let i = 0; i < plaintext.length; i++) plaintext[i] = (i * 7) & 0xff;
    const oneShot = await encryptBytes(plaintext, {
      ...ctx,
      dek,
      chunkSize: 16,
      nonceFactory: nonceFactory(),
    });
    const streamedParts: Uint8Array[] = [];
    async function* source() {
      for (let i = 0; i < plaintext.length; i += 37) yield plaintext.subarray(i, i + 37);
    }
    const { encryptChunks } = await import("../src/index");
    for await (const part of encryptChunks(source(), {
      ...ctx,
      dek,
      chunkSize: 16,
      nonceFactory: nonceFactory(),
    })) {
      streamedParts.push(part);
    }
    const streamed = new Uint8Array(streamedParts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const part of streamedParts) {
      streamed.set(part, offset);
      offset += part.length;
    }
    expect(streamed).toEqual(oneShot);
  });
});
