import { ERROR_CODES } from "@omnicloud/shared";
import type { ErrorCode } from "@omnicloud/shared";

/**
 * Base class for all domain errors. The API maps these to structured HTTP
 * responses; everything else becomes a 500.
 */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, status: number, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Invalid request payload — 400. */
export class ValidationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(ERROR_CODES.INVALID_REQUEST, 400, message, details);
  }
}

/** Missing browser session — 401. */
export class UnauthorizedError extends DomainError {
  constructor(message = "Authentication required") {
    super(ERROR_CODES.AUTH_REQUIRED, 401, message);
  }
}

/** Invalid credentials or expired session token — 401. */
export class AuthInvalidError extends DomainError {
  constructor(message = "Your session is no longer valid — please sign in again") {
    super(ERROR_CODES.AUTH_INVALID, 401, message);
  }
}

/** Authenticated but not allowed — 403. */
export class ForbiddenError extends DomainError {
  constructor(message = "You do not have access to this resource") {
    super(ERROR_CODES.PERMISSION_DENIED, 403, message);
  }
}

/**
 * Used for missing resources as well as resources owned by someone else, to
 * avoid leaking existence. `resource` narrows the error code.
 */
export class NotFoundError extends DomainError {
  constructor(message = "Resource not found", resource?: "file" | "folder") {
    super(
      resource === "file"
        ? ERROR_CODES.FILE_NOT_FOUND
        : resource === "folder"
          ? ERROR_CODES.FOLDER_NOT_FOUND
          : ERROR_CODES.NOT_FOUND,
      404,
      message,
    );
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(ERROR_CODES.CONFLICT, 409, message);
  }
}

export class PayloadTooLargeError extends DomainError {
  constructor(message = "File is too large") {
    super(ERROR_CODES.PAYLOAD_TOO_LARGE, 413, message);
  }
}

export class RateLimitedError extends DomainError {
  constructor(message = "Too many requests, please retry later") {
    super(ERROR_CODES.RATE_LIMITED, 429, message);
  }
}

/** The user has no storage backend set up yet — 409. */
export class StorageNotInitializedError extends DomainError {
  constructor() {
    super(ERROR_CODES.STORAGE_NOT_INITIALIZED, 409, "Storage is not initialized for this account");
  }
}

/** The storage backend is reachable but failing — 503. */
export class StorageUnavailableError extends DomainError {
  constructor(message = "Storage is temporarily unavailable", details?: unknown) {
    super(ERROR_CODES.STORAGE_UNAVAILABLE, 503, message, details);
  }
}

/** Telegram needs re-authentication — 401. */
export class TelegramAuthRequiredError extends DomainError {
  constructor(message = "Your Telegram session has expired — please reconnect") {
    super(ERROR_CODES.TELEGRAM_AUTH_REQUIRED, 401, message);
  }
}

/** Telegram connection could not be established — 502. */
export class TelegramConnectionError extends DomainError {
  constructor(message = "Could not reach Telegram", details?: unknown) {
    super(ERROR_CODES.TELEGRAM_CONNECTION_FAILED, 502, message, details);
  }
}

/** The stored object is missing from Telegram — 404. */
export class TelegramFileNotFoundError extends DomainError {
  constructor(message = "The stored file is missing from Telegram") {
    super(ERROR_CODES.TELEGRAM_FILE_NOT_FOUND, 404, message);
  }
}

/** Upload failed — 502. */
export class UploadFailedError extends DomainError {
  constructor(message = "Upload failed", details?: unknown) {
    super(ERROR_CODES.UPLOAD_FAILED, 502, message, details);
  }
}

/** Download failed — 502. */
export class DownloadFailedError extends DomainError {
  constructor(message = "Download failed", details?: unknown) {
    super(ERROR_CODES.DOWNLOAD_FAILED, 502, message, details);
  }
}

/** Integrity verification failed — 502. */
export class IntegrityCheckError extends DomainError {
  constructor(message = "Integrity check failed", details?: unknown) {
    super(ERROR_CODES.INTEGRITY_CHECK_FAILED, 502, message, details);
  }
}

/** Operation cancelled by the client — 499 (non-standard but conventional). */
export class OperationCancelledError extends DomainError {
  constructor(message = "Operation cancelled") {
    super(ERROR_CODES.INVALID_REQUEST, 499, message);
  }
}

/** @deprecated Use the specific storage errors. Kept for provider compatibility. */
export class StorageProviderError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(ERROR_CODES.TELEGRAM_CONNECTION_FAILED, 502, message, details);
  }
}

/** True when the value is one of our structured domain errors. */
export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

/**
 * Wraps an arbitrary provider failure as an UploadFailedError (the default
 * storage-operation error), preserving domain errors untouched.
 */
export function mapProviderError(message: string, error: unknown): DomainError {
  if (error instanceof DomainError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new UploadFailedError(detail ? `${message}: ${detail}` : message, error);
}
