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

export class ValidationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(ERROR_CODES.VALIDATION, 400, message, details);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = "Authentication required") {
    super(ERROR_CODES.UNAUTHENTICATED, 401, message);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "You do not have access to this resource") {
    super(ERROR_CODES.FORBIDDEN, 403, message);
  }
}

/** Used for missing resources as well as resources owned by someone else, to avoid leaking existence. */
export class NotFoundError extends DomainError {
  constructor(message = "Resource not found") {
    super(ERROR_CODES.NOT_FOUND, 404, message);
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

/** The user has no storage backend set up yet. */
export class StorageNotInitializedError extends DomainError {
  constructor() {
    super(ERROR_CODES.STORAGE_NOT_INITIALIZED, 409, "Storage is not initialized for this account");
  }
}

/** The underlying storage backend (e.g. Telegram) failed. */
export class StorageProviderError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(ERROR_CODES.TELEGRAM_ERROR, 502, message, details);
  }
}
