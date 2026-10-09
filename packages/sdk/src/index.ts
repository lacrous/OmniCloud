/**
 * @lacrous/omnicloud — developer SDK for OmniCloud v0.2.
 *
 * Contains:
 * - `OmniCloudClient`: namespaced HTTP client for an OmniCloud server,
 *   with pagination, retry and upload/download progress (browser + Node)
 * - The storage abstraction (`StorageProvider`, `StorageEngine`)
 * - `TelegramClientManager`, `TelegramConnectionService`, `TelegramStorageProvider`
 * - Domain services (`FileService`, `FolderService`, `SearchService`, `StatsService`,
 *   `TrashService`, `IntegrityService`, `RecentService`, `ActivityService`)
 *
 * The Telegram provider is server-side only (it needs a persistent MTProto
 * connection); `OmniCloudClient` works anywhere.
 */

export { OmniCloudClient, OmniCloudError } from "./client";
export type {
  DownloadProgress,
  DownloadResult,
  OmniCloudClientOptions,
  RetryOptions,
  UploadInput,
  StreamedDownload,
  UploadOptions,
  UploadProgress,
} from "./client";

// Storage abstraction & services (from the core).
export {
  StorageEngine,
  mapProviderError,
  sha256Hex,
  sanitizeFileName,
  ActivityService,
  FileService,
  FolderService,
  IntegrityService,
  RecentService,
  SearchService,
  StatsService,
  TrashService,
  noopActivityRecorder,
} from "@omnicloud/core";
export type {
  ActivityEventRecord,
  ActivityRecorder,
  ConnectionState,
  DomainError,
  EngineResolver,
  EngineRetryPolicy,
  EngineUploadResult,
  FileDownload,
  FileRecord,
  FileVersionRecord,
  FileTypeBucket,
  FolderMutationResult,
  FolderRecord,
  IntegrityCheckOptions,
  ItemQuery,
  PageRequest,
  Paged,
  Repos,
  StorageHealth,
  StorageProvider,
  StorageRecord,
  StorageStats,
  StorageUploadInput,
  StoredObject,
  StoredRef,
  TransferControl,
  TransferProgress,
  UserRecord,
} from "@omnicloud/core";

// Telegram integration (server-side).
export {
  TELEGRAM_PROVIDER,
  TelegramClientManager,
  TelegramConnectionService,
  TelegramStorageProvider,
  mapTelegramError,
} from "@omnicloud/telegram";
export type {
  ConnectionStatus,
  TelegramCredentials,
  TelegramStorageOptions,
} from "@omnicloud/telegram";

// Shared DTOs, error codes and query helpers.
export {
  ERROR_CODES,
  fileCategory,
  isFileCategory,
  mimeFromFilename,
  mimeMatchersForType,
  parseSearchQuery,
  parseSize,
  paginationMeta,
} from "@omnicloud/shared";
export type {
  ActivityEventDTO,
  ActivityPageDTO,
  ApiErrorBody,
  BatchResultDTO,
  FolderMutationResultDTO,
  EmptyTrashResultDTO,
  ErrorCode,
  FileCategory,
  FileDTO,
  FileVersionDTO,
  FilesPageDTO,
  FoldersPageDTO,
  FolderDTO,
  HealthDTO,
  HealthStatus,
  IntegrityIssueDTO,
  IntegrityReportDTO,
  ItemStatus,
  ListQuery,
  PaginationDTO,
  RecentItemDTO,
  RecentPageDTO,
  SearchResultDTO,
  SessionInfo,
  SortField,
  SortOrder,
  StorageDTO,
  StorageHealthDTO,
  StorageStatsDTO,
  StorageTypeBreakdownDTO,
  TelegramVerifyResponse,
  TrashPageDTO,
  UserDTO,
} from "@omnicloud/shared";
