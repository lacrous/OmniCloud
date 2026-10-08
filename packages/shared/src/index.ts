/**
 * Data transfer objects, constants and error codes shared between the API,
 * the web app, and the @lacrous/omnicloud SDK.
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
] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export const RESOURCE_TYPES = ["file", "folder", "storage"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

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
  name: string;
  kind: "missing" | "size_mismatch" | "unreadable" | "hash_mismatch";
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

export * from "./mime";
export * from "./query";
