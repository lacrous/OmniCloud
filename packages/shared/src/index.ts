/**
 * Data transfer objects, constants and error codes shared between the API,
 * the web app, and the @hilbras/omnicloud SDK.
 *
 * Telegram identifiers that may exceed JavaScript's safe integer range are
 * transported as strings across the API boundary.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Identity & storage
// ─────────────────────────────────────────────────────────────────────────────

export interface UserDTO {
  id: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface StorageDTO {
  id: string;
  provider: string;
  title: string;
  createdAt: string;
}

/** Connection state of the underlying storage backend. */
export type ConnectionState =
  "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "RECONNECTING" | "ERROR" | "AUTH_REQUIRED";

export type HealthStatus = "healthy" | "degraded" | "unavailable" | "unknown";

export interface StorageHealthDTO {
  provider: string;
  state: ConnectionState;
  status: HealthStatus;
  latencyMs: number | null;
  message: string | null;
  channelTitle: string | null;
  checkedAt: string;
}

/** Returned by GET /api/auth/me. `user` is null when not signed in. */
export interface SessionInfo {
  user: UserDTO | null;
  storage: StorageDTO | null;
  health: StorageHealthDTO | null;
}

/** POST /api/auth/telegram/verify response. */
export type TelegramVerifyResponse =
  { status: "ok"; user: UserDTO } | { status: "password_required" };

// ─────────────────────────────────────────────────────────────────────────────
// Files & folders
// ─────────────────────────────────────────────────────────────────────────────

export interface FileDTO {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  sha256: string;
  folderId: string | null;
  starred: boolean;
  trashed: boolean;
  deletedAt: string | null;
  versionCount: number;
  currentVersionId: string | null;
  /** Opaque OCE1 encryption metadata for the current version; null = plaintext. */
  encryptionFormat?: string | null;
  wrappedKey?: string | null;
  metadataBlob?: string | null;
  keyEpoch?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface FolderDTO {
  id: string;
  name: string;
  parentId: string | null;
  starred: boolean;
  trashed: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FileVersionDTO {
  id: string;
  fileId: string;
  versionNumber: number;
  size: number;
  mimeType: string;
  sha256: string;
  telegramMessageId: number;
  isCurrent: boolean;
  /** Opaque OCE1 encryption metadata for this version; null = plaintext. */
  encryptionFormat?: string | null;
  wrappedKey?: string | null;
  metadataBlob?: string | null;
  keyEpoch?: number | null;
  createdAt: string;
}

export interface SearchResultDTO {
  files: FileDTO[];
  folders: FolderDTO[];
  pagination: PaginationDTO;
}

/** Result of a recursive folder deletion / trash operation. */
export interface FolderMutationResultDTO {
  affectedFolders: number;
  affectedFiles: number;
}

export interface EmptyTrashResultDTO {
  deletedFiles: number;
  deletedFolders: number;
  failedFiles: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pagination, sorting & filtering
// ─────────────────────────────────────────────────────────────────────────────

import type { ListQuery } from "./query";

export type { ListQuery, SortField, SortOrder, ItemStatus } from "./query";

export interface PaginationDTO {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface FilesPageDTO {
  files: FileDTO[];
  pagination: PaginationDTO;
}

export interface FoldersPageDTO {
  folders: FolderDTO[];
  pagination: PaginationDTO;
}

export interface TrashPageDTO {
  files: FileDTO[];
  folders: FolderDTO[];
  pagination: PaginationDTO;
}

/** Alias so callers can name the query shape as query parameters. */
export type QueryParams = ListQuery;

// ─────────────────────────────────────────────────────────────────────────────
// Recent & activity
// ─────────────────────────────────────────────────────────────────────────────

export interface RecentItemDTO {
  file: FileDTO;
  lastAction: ActivityAction;
  lastActionAt: string;
}

export interface RecentPageDTO {
  items: RecentItemDTO[];
  pagination: PaginationDTO;
}

export const ACTIVITY_ACTIONS = [
  "upload",
  "download",
  "open",
  "rename",
  "move",
  "star",
  "unstar",
  "trash",
  "restore",
  "delete",
  "create_folder",
  "replace",
  "restore_version",
  "delete_version",
  /** A stored action this version does not recognise. */
  "other",
] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

/** True when the value is a known activity action. */
export function isActivityAction(value: string): value is ActivityAction {
  return (ACTIVITY_ACTIONS as readonly string[]).includes(value);
}

export const RESOURCE_TYPES = ["file", "folder", "storage"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

/** True when the value is a known resource type. */
export function isResourceType(value: string): value is ResourceType {
  return (RESOURCE_TYPES as readonly string[]).includes(value);
}

export interface ActivityEventDTO {
  id: string;
  action: ActivityAction;
  resourceType: ResourceType;
  resourceId: string;
  resourceName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ActivityPageDTO {
  events: ActivityEventDTO[];
  pagination: PaginationDTO;
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage statistics
// ─────────────────────────────────────────────────────────────────────────────

export interface StorageTypeBreakdownDTO {
  category: string;
  bytes: number;
  count: number;
}

export interface StorageStatsDTO {
  fileCount: number;
  folderCount: number;
  totalBytes: number;
  trashBytes: number;
  trashFileCount: number;
  starredCount: number;
  byType: StorageTypeBreakdownDTO[];
  largestFiles: FileDTO[];
  quotaBytes: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Health & integrity
// ─────────────────────────────────────────────────────────────────────────────

export interface HealthDTO {
  status: HealthStatus;
  database: HealthStatus;
  storage: HealthStatus;
  uptimeSeconds: number;
  version: string;
}

export interface IntegrityIssueDTO {
  fileId: string;
  /** Set when the issue is with a historical version rather than the current object. */
  versionId?: string;
  name: string;
  kind: "missing" | "size_mismatch" | "unreadable" | "hash_mismatch";
  detail: string | null;
}

/**
 * Result of the periodic "is a newer release available?" check.
 *
 * `status` distinguishes the states the UI must react to differently:
 * `update_available` is the only one that should prompt the user.
 */
export interface UpdateCheckDTO {
  status: "update_available" | "up_to_date" | "unknown" | "not_published";
  /** The version currently running on the server. */
  currentVersion: string;
  /** The newest version on npm; null when it could not be determined. */
  latestVersion: string | null;
  /** npm package the check is performed against. */
  packageName: string;
  /** When the check last completed, ISO-8601. */
  checkedAt: string;
  /** Human-readable reason, only for `unknown` / `not_published`. */
  detail: string | null;
}

export interface IntegrityReportDTO {
  checkedAt: string;
  filesChecked: number;
  healthy: number;
  missing: number;
  inconsistent: number;
  unreadable: number;
  issues: IntegrityIssueDTO[];
  durationMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch operations
// ─────────────────────────────────────────────────────────────────────────────

export const BATCH_FILE_OPERATIONS = [
  "trash",
  "restore",
  "delete",
  "star",
  "unstar",
  "move",
] as const;
export type BatchFileOperation = (typeof BATCH_FILE_OPERATIONS)[number];

export const BATCH_FOLDER_OPERATIONS = [
  "trash",
  "restore",
  "delete",
  "star",
  "unstar",
  "move",
] as const;
export type BatchFolderOperation = (typeof BATCH_FOLDER_OPERATIONS)[number];

export interface BatchResultDTO {
  requested: number;
  succeeded: number;
  failed: number;
  errors: { id: string; code: ErrorCode; message: string }[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

/** Stable machine-readable error codes returned in API error bodies. */
export const ERROR_CODES = {
  AUTH_REQUIRED: "AUTH_REQUIRED",
  AUTH_INVALID: "AUTH_INVALID",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  INVALID_REQUEST: "INVALID_REQUEST",
  NOT_FOUND: "NOT_FOUND",
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  FOLDER_NOT_FOUND: "FOLDER_NOT_FOUND",
  CONFLICT: "CONFLICT",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  RATE_LIMITED: "RATE_LIMITED",
  STORAGE_NOT_INITIALIZED: "STORAGE_NOT_INITIALIZED",
  STORAGE_UNAVAILABLE: "STORAGE_UNAVAILABLE",
  TELEGRAM_AUTH_REQUIRED: "TELEGRAM_AUTH_REQUIRED",
  TELEGRAM_CONNECTION_FAILED: "TELEGRAM_CONNECTION_FAILED",
  TELEGRAM_FILE_NOT_FOUND: "TELEGRAM_FILE_NOT_FOUND",
  UPLOAD_FAILED: "UPLOAD_FAILED",
  DOWNLOAD_FAILED: "DOWNLOAD_FAILED",
  INTEGRITY_CHECK_FAILED: "INTEGRITY_CHECK_FAILED",
  INTERNAL: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export const SESSION_COOKIE = "omnicloud_session";
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * The encrypted formats a file may be stored in.
 *
 * - `OCE1` encrypts the content and the metadata blob. The file's name is
 *   still stored in the clear.
 * - `OCE2` also hides the name: the server stores an opaque placeholder and
 *   the real name lives only in the client's encrypted index.
 */
export const ENCRYPTION_FORMAT_OCE1 = "OCE1";
export const ENCRYPTION_FORMAT_OCE2 = "OCE2";
export const ENCRYPTION_FORMATS = [ENCRYPTION_FORMAT_OCE1, ENCRYPTION_FORMAT_OCE2] as const;
export type EncryptionFormat = (typeof ENCRYPTION_FORMATS)[number];

/** True when the value is a known encryption format. */
export function isEncryptionFormat(value: string): value is EncryptionFormat {
  return (ENCRYPTION_FORMATS as readonly string[]).includes(value);
}

export * from "./mime";
export * from "./opaque-name";
export * from "./query";
export * from "./search";
