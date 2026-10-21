import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { randomBytes } from "@noble/hashes/utils";
import {
  AuthenticationError,
  BindingError,
  ManifestError,
  TrailingDataError,
  UnsupportedFormatError,
  ValidationError,
} from "./errors";
import { ID_BYTES, KEY_BYTES, assertKeyMaterial, deriveKek, deriveMek } from "./keys";

export const MAGIC = new Uint8Array([0x4f, 0x43, 0x45, 0x31]);
export const FORMAT_VERSION = 1;
export const SUITE = 1;
export const KEY_EPOCH_V1 = 0;
export const HEADER_SIZE = 48;
export const NONCE_BYTES = 24;
export const TAG_BYTES = 16;
export const CHUNK_SIZE_DEFAULT = 4 * 1024 * 1024;
export const CHUNK_SIZE_HARD_MAX = 64 * 1024 * 1024;
export const ENCRYPTION_FORMAT = "OCE1";

const AAD_TYPE_DATA = 0x00;
const AAD_TYPE_MANIFEST = 0x01;
const AAD_TYPE_DEK = 0x02;
const AAD_TYPE_METADATA = 0x03;

export interface Oce1Header {
  version: number;
  suite: number;
  keyEpoch: number;
  fileId: Uint8Array;
  versionId: Uint8Array;
}

export interface FileMetadata {
  name: string;
  mimeType?: string;
  description?: string;
}

export interface VersionContext {
  fileId: Uint8Array;
  versionId: Uint8Array;
  keyEpoch?: number;
}

export interface EncryptVersionOptions extends VersionContext {
  dek: Uint8Array;
  chunkSize?: number;
  /** Test-only: supplies every 24-byte nonce in sequence (records, manifest, wrappedKey, metadata). */
  nonceFactory?: () => Uint8Array;
}

export interface EncryptedVersion {
  envelope: Uint8Array;
  wrappedKey: Uint8Array;
  metadataBlob: Uint8Array;
}

export interface DecryptVersionOptions extends VersionContext {
  urk: Uint8Array;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function u32be(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

function readU32be(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function defaultNonceFactory(): Uint8Array {
  return randomBytes(NONCE_BYTES);
}

function assertNonce(nonce: Uint8Array): void {
  if (!(nonce instanceof Uint8Array) || nonce.length !== NONCE_BYTES) {
    throw new ValidationError("nonce must be 24 bytes");
  }
}

function assertContext(ctx: VersionContext): number {
  if (!(ctx.fileId instanceof Uint8Array) || ctx.fileId.length !== ID_BYTES) {
    throw new ValidationError("fileId must be 16 bytes");
  }
  if (!(ctx.versionId instanceof Uint8Array) || ctx.versionId.length !== ID_BYTES) {
    throw new ValidationError("versionId must be 16 bytes");
  }
  const epoch = ctx.keyEpoch ?? KEY_EPOCH_V1;
  if (!Number.isInteger(epoch) || epoch < 0 || epoch > 0xffffffff) {
    throw new ValidationError("keyEpoch must be a uint32");
  }
  return epoch;
}

function aadPrefix(ctx: VersionContext, epoch: number): Uint8Array {
  return concat(
    MAGIC,
    new Uint8Array([FORMAT_VERSION, SUITE]),
    u32be(epoch),
    ctx.fileId,
    ctx.versionId,
  );
}

function buildAad(ctx: VersionContext, epoch: number, type: number, index?: number): Uint8Array {
  if (type === AAD_TYPE_DATA)
    return concat(aadPrefix(ctx, epoch), new Uint8Array([type]), u32be(index!));
  return concat(aadPrefix(ctx, epoch), new Uint8Array([type]));
}

function buildHeader(ctx: VersionContext, epoch: number): Uint8Array {
  return concat(
    MAGIC,
    new Uint8Array([FORMAT_VERSION, SUITE, 0x00, 0x00]),
    u32be(epoch),
    ctx.fileId,
    ctx.versionId,
    new Uint8Array(4),
  );
}

export function readHeader(envelope: Uint8Array): Oce1Header {
  if (!(envelope instanceof Uint8Array) || envelope.length < HEADER_SIZE) {
    throw new UnsupportedFormatError("envelope shorter than header");
  }
  if (!bytesEqual(envelope.subarray(0, 4), MAGIC)) throw new UnsupportedFormatError("bad magic");
  const version = envelope[4]!;
  const suite = envelope[5]!;
  const flags = envelope[6]!;
  const reserved = envelope[7]!;
  if (version !== FORMAT_VERSION) throw new UnsupportedFormatError("unsupported version");
  if (suite !== SUITE) throw new UnsupportedFormatError("unsupported suite");
  if (flags !== 0 || reserved !== 0) throw new UnsupportedFormatError("unsupported flags");
  for (let i = 44; i < HEADER_SIZE; i++) {
    if (envelope[i] !== 0) throw new UnsupportedFormatError("unsupported flags");
  }
  return {
    version,
    suite,
    keyEpoch: readU32be(envelope, 8),
    fileId: envelope.slice(12, 28),
    versionId: envelope.slice(28, 44),
  };
}

function seal(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  return xchacha20poly1305(key, nonce, aad).encrypt(plaintext);
}

function open(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  try {
    return xchacha20poly1305(key, nonce, aad).decrypt(ciphertext);
  } catch {
    throw new AuthenticationError("authentication failed");
  }
}

function encodeRecord(
  plaintext: Uint8Array,
  key: Uint8Array,
  aad: Uint8Array,
  nextNonce: () => Uint8Array,
): Uint8Array {
  const nonce = nextNonce();
  assertNonce(nonce);
  const ct = seal(key, nonce, plaintext, aad);
  return concat(u32be(ct.length), nonce, ct);
}

async function* toAsyncIterable(
  source: AsyncIterable<Uint8Array> | Iterable<Uint8Array> | Uint8Array,
): AsyncGenerator<Uint8Array> {
  if (source instanceof Uint8Array) {
    yield source;
    return;
  }
  for await (const chunk of source) {
    if (!(chunk instanceof Uint8Array))
      throw new ValidationError("source must yield Uint8Array chunks");
    yield chunk;
  }
}

export async function* encryptChunks(
  source: AsyncIterable<Uint8Array> | Iterable<Uint8Array> | Uint8Array,
  options: EncryptVersionOptions,
): AsyncGenerator<Uint8Array> {
  assertKeyMaterial("dek", options.dek);
  const epoch = assertContext(options);
  const chunkSize = options.chunkSize ?? CHUNK_SIZE_DEFAULT;
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > CHUNK_SIZE_HARD_MAX) {
    throw new ValidationError("chunkSize out of range");
  }
  const nextNonce = options.nonceFactory ?? defaultNonceFactory;
  const header = buildHeader(options, epoch);
  yield header;

  let carry: Uint8Array = new Uint8Array(0);
  let index = 0;
  let total = 0;
  const emit = (plaintext: Uint8Array): Uint8Array => {
    const record = encodeRecord(
      plaintext,
      options.dek,
      buildAad(options, epoch, AAD_TYPE_DATA, index),
      nextNonce,
    );
    index += 1;
    total += plaintext.length;
    return record;
  };

  for await (const chunk of toAsyncIterable(source)) {
    let offset = 0;
    while (offset < chunk.length) {
      const take = Math.min(chunkSize - carry.length, chunk.length - offset);
      const part = chunk.subarray(offset, offset + take);
      offset += take;
      if (carry.length === 0 && take === chunkSize) {
        yield emit(part);
        continue;
      }
      const merged = concat(carry, part);
      if (merged.length === chunkSize) {
        carry = new Uint8Array(0);
        yield emit(merged);
      } else {
        carry = merged;
      }
    }
  }
  if (carry.length > 0 || index === 0) yield emit(carry);

  const manifest = new TextEncoder().encode(JSON.stringify({ chunks: index, size: total, v: 1 }));
  yield encodeRecord(manifest, options.dek, buildAad(options, epoch, AAD_TYPE_MANIFEST), nextNonce);
}

export async function encryptBytes(
  plaintext: Uint8Array,
  options: EncryptVersionOptions,
): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const record of encryptChunks([plaintext], options)) parts.push(record);
  return concat(...parts);
}

class ByteReader {
  private buffer: Uint8Array = new Uint8Array(0);
  private done = false;
  constructor(private readonly source: AsyncGenerator<Uint8Array>) {}

  private async fill(): Promise<boolean> {
    const next = await this.source.next();
    if (next.done) {
      this.done = true;
      return false;
    }
    this.buffer = concat(this.buffer, next.value);
    return true;
  }

  async readExactly(length: number): Promise<Uint8Array> {
    while (this.buffer.length < length) {
      if (!(await this.fill())) {
        throw new UnsupportedFormatError("truncated envelope");
      }
    }
    const out = this.buffer.slice(0, length);
    this.buffer = this.buffer.slice(length);
    return out;
  }

  async atEnd(): Promise<boolean> {
    while (this.buffer.length === 0) {
      if (this.done) return true;
      if (!(await this.fill())) return true;
    }
    return false;
  }
}

interface ParsedRecord {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

async function readRecord(reader: ByteReader): Promise<ParsedRecord> {
  const lengthBytes = await reader.readExactly(4);
  const length = readU32be(lengthBytes, 0);
  if (length < TAG_BYTES || length > CHUNK_SIZE_HARD_MAX + TAG_BYTES) {
    throw new UnsupportedFormatError("invalid record length");
  }
  const nonce = await reader.readExactly(NONCE_BYTES);
  const ciphertext = await reader.readExactly(length);
  return { ciphertext, nonce };
}

export interface DecryptStreamOptions extends DecryptVersionOptions {
  envelope: AsyncIterable<Uint8Array> | Iterable<Uint8Array> | Uint8Array;
  wrappedKey: Uint8Array;
}

export async function* decryptChunks(options: DecryptStreamOptions): AsyncGenerator<Uint8Array> {
  assertKeyMaterial("urk", options.urk);
  const expectedEpoch = assertContext(options);
  const reader = new ByteReader(toAsyncIterable(options.envelope));
  const header = readHeader(await reader.readExactly(HEADER_SIZE));
  if (header.keyEpoch !== expectedEpoch) throw new BindingError("key epoch mismatch");
  if (!bytesEqual(header.fileId, options.fileId)) throw new BindingError("fileId mismatch");
  if (!bytesEqual(header.versionId, options.versionId))
    throw new BindingError("versionId mismatch");

  const dek = unwrapDek(deriveKek(options.urk), options.wrappedKey, options, expectedEpoch);

  let index = 0;
  let total = 0;
  let manifestSeen = false;
  const expectedManifest = (chunks: number, size: number): Uint8Array =>
    new TextEncoder().encode(JSON.stringify({ chunks, size, v: 1 }));

  while (true) {
    if (await reader.atEnd()) break;
    if (manifestSeen) throw new TrailingDataError("trailing bytes after manifest");
    const record = await readRecord(reader);
    if (index >= 1) {
      try {
        const manifest = open(
          dek,
          record.nonce,
          record.ciphertext,
          buildAad(options, expectedEpoch, AAD_TYPE_MANIFEST),
        );
        let parsed: { chunks: unknown; size: unknown; v: unknown };
        try {
          parsed = JSON.parse(new TextDecoder().decode(manifest)) as {
            chunks: unknown;
            size: unknown;
            v: unknown;
          };
        } catch {
          throw new ManifestError("manifest is not valid JSON");
        }
        const keys = Object.keys(parsed).sort().join(",");
        if (keys !== "chunks,size,v") throw new ManifestError("manifest has unexpected fields");
        if (parsed.v !== 1 || !Number.isInteger(parsed.chunks) || !Number.isInteger(parsed.size)) {
          throw new ManifestError("manifest fields invalid");
        }
        if (parsed.chunks !== index) throw new ManifestError("manifest chunk count mismatch");
        if (parsed.size !== total) throw new ManifestError("manifest size mismatch");
        if (!bytesEqual(manifest, expectedManifest(index, total)))
          throw new ManifestError("manifest not canonical");
        manifestSeen = true;
        continue;
      } catch (err) {
        if (!(err instanceof AuthenticationError)) throw err;
      }
    }
    const plaintext = open(
      dek,
      record.nonce,
      record.ciphertext,
      buildAad(options, expectedEpoch, AAD_TYPE_DATA, index),
    );
    if (plaintext.length > CHUNK_SIZE_HARD_MAX) throw new UnsupportedFormatError("chunk too large");
    index += 1;
    total += plaintext.length;
    yield plaintext;
  }
  if (!manifestSeen) throw new ManifestError("manifest missing");
}

export async function decryptBytes(options: DecryptStreamOptions): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const chunk of decryptChunks(options)) parts.push(chunk);
  return concat(...parts);
}

export function wrapDek(
  kek: Uint8Array,
  dek: Uint8Array,
  ctx: VersionContext,
  nonceFactory: () => Uint8Array = defaultNonceFactory,
): Uint8Array {
  assertKeyMaterial("kek", kek);
  assertKeyMaterial("dek", dek);
  const epoch = assertContext(ctx);
  const nonce = nonceFactory();
  assertNonce(nonce);
  return concat(nonce, seal(kek, nonce, dek, buildAad(ctx, epoch, AAD_TYPE_DEK)));
}

export function unwrapDek(
  kek: Uint8Array,
  wrappedKey: Uint8Array,
  ctx: VersionContext,
  epoch: number,
): Uint8Array {
  assertKeyMaterial("kek", kek);
  if (!(wrappedKey instanceof Uint8Array) || wrappedKey.length < NONCE_BYTES + TAG_BYTES) {
    throw new UnsupportedFormatError("wrappedKey too short");
  }
  const dek = open(
    kek,
    wrappedKey.subarray(0, NONCE_BYTES),
    wrappedKey.subarray(NONCE_BYTES),
    buildAad(ctx, epoch, AAD_TYPE_DEK),
  );
  assertKeyMaterial("dek", dek);
  return dek;
}

function canonicalMetadata(metadata: FileMetadata): Uint8Array {
  if (!metadata || typeof metadata.name !== "string" || metadata.name.length === 0) {
    throw new ValidationError("metadata.name is required");
  }
  const obj: Record<string, string> = { name: metadata.name };
  if (metadata.mimeType !== undefined) {
    if (typeof metadata.mimeType !== "string")
      throw new ValidationError("metadata.mimeType must be a string");
    obj.mimeType = metadata.mimeType;
  }
  if (metadata.description !== undefined) {
    if (typeof metadata.description !== "string")
      throw new ValidationError("metadata.description must be a string");
    obj.description = metadata.description;
  }
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(obj).sort()) sorted[key] = obj[key]!;
  return new TextEncoder().encode(JSON.stringify(sorted));
}

export function encryptMetadata(
  mek: Uint8Array,
  metadata: FileMetadata,
  ctx: VersionContext,
  nonceFactory: () => Uint8Array = defaultNonceFactory,
): Uint8Array {
  assertKeyMaterial("mek", mek);
  const epoch = assertContext(ctx);
  const nonce = nonceFactory();
  assertNonce(nonce);
  return concat(
    nonce,
    seal(mek, nonce, canonicalMetadata(metadata), buildAad(ctx, epoch, AAD_TYPE_METADATA)),
  );
}

export function decryptMetadata(
  mek: Uint8Array,
  metadataBlob: Uint8Array,
  ctx: VersionContext,
): FileMetadata {
  assertKeyMaterial("mek", mek);
  const epoch = assertContext(ctx);
  if (!(metadataBlob instanceof Uint8Array) || metadataBlob.length < NONCE_BYTES + TAG_BYTES) {
    throw new UnsupportedFormatError("metadataBlob too short");
  }
  const plaintext = open(
    mek,
    metadataBlob.subarray(0, NONCE_BYTES),
    metadataBlob.subarray(NONCE_BYTES),
    buildAad(ctx, epoch, AAD_TYPE_METADATA),
  );
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Record<string, unknown>;
  } catch {
    throw new AuthenticationError("metadata authentication failed");
  }
  const allowed = new Set(["name", "mimeType", "description"]);
  for (const key of Object.keys(parsed)) {
    if (!allowed.has(key)) throw new ValidationError("metadata has unexpected fields");
  }
  if (typeof parsed.name !== "string" || parsed.name.length === 0)
    throw new ValidationError("metadata.name is required");
  const out: FileMetadata = { name: parsed.name };
  if (parsed.mimeType !== undefined) {
    if (typeof parsed.mimeType !== "string")
      throw new ValidationError("metadata.mimeType must be a string");
    out.mimeType = parsed.mimeType;
  }
  if (parsed.description !== undefined) {
    if (typeof parsed.description !== "string")
      throw new ValidationError("metadata.description must be a string");
    out.description = parsed.description;
  }
  return out;
}

export async function encryptFile(
  plaintext: Uint8Array,
  options: {
    urk: Uint8Array;
    metadata: FileMetadata;
    fileId?: Uint8Array;
    versionId?: Uint8Array;
    keyEpoch?: number;
    chunkSize?: number;
    nonceFactory?: () => Uint8Array;
  },
): Promise<EncryptedVersion & { fileId: Uint8Array; versionId: Uint8Array; keyEpoch: number }> {
  const fileId = options.fileId ?? new Uint8Array(randomBytes(ID_BYTES));
  const versionId = options.versionId ?? new Uint8Array(randomBytes(ID_BYTES));
  const keyEpoch = options.keyEpoch ?? KEY_EPOCH_V1;
  const nextNonce = options.nonceFactory ?? defaultNonceFactory;
  const dek = new Uint8Array(randomBytes(KEY_BYTES));
  const ctx: VersionContext = { fileId, versionId, keyEpoch };
  const envelope = await encryptBytes(plaintext, {
    ...ctx,
    dek,
    chunkSize: options.chunkSize,
    nonceFactory: nextNonce,
  });
  const wrappedKey = wrapDek(deriveKek(options.urk), dek, ctx, nextNonce);
  const metadataBlob = encryptMetadata(deriveMek(options.urk), options.metadata, ctx, nextNonce);
  return { envelope, wrappedKey, metadataBlob, fileId, versionId, keyEpoch };
}

export async function decryptFile(
  options: DecryptVersionOptions & {
    envelope: AsyncIterable<Uint8Array> | Iterable<Uint8Array> | Uint8Array;
    wrappedKey: Uint8Array;
    metadataBlob: Uint8Array;
  },
): Promise<{ plaintext: Uint8Array; metadata: FileMetadata }> {
  const metadata = decryptMetadata(deriveMek(options.urk), options.metadataBlob, options);
  const plaintext = await decryptBytes({ ...options });
  return { plaintext, metadata };
}
