/**
 * Data transfer objects and constants shared between the API, the web app,
 * and the @lacrous/omnicloud SDK.
 *
 * Telegram identifiers that may exceed JavaScript's safe integer range are
 * transported as strings across the API boundary.
 */

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

/** Returned by GET /api/auth/me. `user` is null when not signed in. */
export interface SessionInfo {
  user: UserDTO | null;
  storage: StorageDTO | null;
}

export interface FileDTO {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  sha256: string;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FolderDTO {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SearchResultDTO {
  files: FileDTO[];
  folders: FolderDTO[];
}

export interface DeleteFolderResultDTO {
  deletedFolders: number;
  deletedFiles: number;
}

/** POST /api/auth/telegram/verify response. */
export type TelegramVerifyResponse =
  { status: "ok"; user: UserDTO } | { status: "password_required" };

/** Stable machine-readable error codes returned in API error bodies. */
export const ERROR_CODES = {
  VALIDATION: "VALIDATION_ERROR",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  RATE_LIMITED: "RATE_LIMITED",
  STORAGE_NOT_INITIALIZED: "STORAGE_NOT_INITIALIZED",
  TELEGRAM_ERROR: "TELEGRAM_ERROR",
  INTERNAL: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export const SESSION_COOKIE = "omnicloud_session";

export * from "./mime";
