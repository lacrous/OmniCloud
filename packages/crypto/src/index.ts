export {
  AuthenticationError,
  BindingError,
  ManifestError,
  Oce1Error,
  TrailingDataError,
  UnsupportedFormatError,
  ValidationError,
} from "./errors";
export {
  CHUNK_SIZE_DEFAULT,
  CHUNK_SIZE_HARD_MAX,
  ENCRYPTION_FORMAT,
  FORMAT_VERSION,
  HEADER_SIZE,
  KEY_EPOCH_V1,
  MAGIC,
  NONCE_BYTES,
  SUITE,
  TAG_BYTES,
  decryptBytes,
  decryptChunks,
  decryptFile,
  decryptMetadata,
  encryptBytes,
  encryptChunks,
  encryptFile,
  encryptMetadata,
  readHeader,
  unwrapDek,
  wrapDek,
} from "./envelope";
export type {
  DecryptStreamOptions,
  DecryptVersionOptions,
  EncryptedVersion,
  EncryptVersionOptions,
  FileMetadata,
  Oce1Header,
  VersionContext,
} from "./envelope";
export {
  ID_BYTES,
  KEY_BYTES,
  assertKeyMaterial,
  deriveKek,
  deriveMek,
  generateDek,
  generateId,
  generateUrk,
} from "./keys";
export {
  INDEX_AAD_TYPE,
  INDEX_CONTAINER_VERSION,
  INDEX_HKDF_SALT,
  INDEX_KEY_INFO,
  OCE2_MAGIC,
  canonicalIndexJson,
  createIndexContainer,
  deriveIndexKey,
  openIndexContainer,
  parseIndexJson,
} from "./name-index";
export type { IndexEntry } from "./name-index";
export {
  RECOVERY_BLOB_BYTES,
  RECOVERY_CODE_BYTES,
  createRecoveryBlob,
  formatRecoveryCode,
  generateRecoveryCode,
  openRecoveryBlob,
  parseRecoveryCode,
} from "./recovery";
export { sha256Hex } from "./hash";
