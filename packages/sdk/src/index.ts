/**
 * @lacrous/omnicloud — developer SDK for OmniCloud.
 *
 * Contains:
 * - `OmniCloudClient`: HTTP client for an OmniCloud server (browser + Node)
 * - The storage abstraction (`StorageProvider`, `StorageEngine`)
 * - `TelegramStorageProvider` and the Telegram connection service
 * - Domain services (`FileService`, `FolderService`, `SearchService`)
 *
 * The Telegram provider is server-side only (it needs a persistent MTProto
 * connection); `OmniCloudClient` works anywhere.
 */

export { OmniCloudClient, OmniCloudError } from "./client";
export type { OmniCloudClientOptions, UploadInput, UploadOptions, UploadProgress } from "./client";

// Storage abstraction & services (from the core).
export {
  StorageEngine,
  mapProviderError,
  sha256Hex,
  sanitizeFileName,
  FileService,
  FolderService,
  SearchService,
} from "@omnicloud/core";
export type {
  DomainError,
  EngineUploadResult,
  FileDownload,
  FileRecord,
  FolderDeletionResult,
  FolderRecord,
  Repos,
  StorageProvider,
  StorageRecord,
  StorageUploadInput,
  StoredObject,
  StoredRef,
  UserRecord,
} from "@omnicloud/core";

// Telegram provider (server-side).
export {
  TELEGRAM_PROVIDER,
  TelegramClientManager,
  TelegramConnectionService,
  TelegramStorageProvider,
  mapTelegramError,
} from "@omnicloud/telegram";
export type { TelegramCredentials, TelegramStorageOptions } from "@omnicloud/telegram";

// Shared DTOs & error codes.
export { ERROR_CODES, fileCategory, mimeFromFilename } from "@omnicloud/shared";
export type {
  ApiErrorBody,
  DeleteFolderResultDTO,
  ErrorCode,
  FileCategory,
  FileDTO,
  FolderDTO,
  SearchResultDTO,
  SessionInfo,
  StorageDTO,
  TelegramVerifyResponse,
  UserDTO,
} from "@omnicloud/shared";
