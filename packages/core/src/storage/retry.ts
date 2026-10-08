import { DomainError, OperationCancelledError } from "../errors";

/**
 * Retry decisions come from the error's declared contract, not from its message
 * text. A DomainError says whether it is retryable; anything else is not retried.
 * Cancellation is never retried.
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof OperationCancelledError) return false;
  if (error instanceof DomainError) return error.retryable;
  return false;
}

/**
 * How long to wait before the next attempt. A provider-supplied flood wait is
 * honoured exactly; otherwise exponential backoff with full jitter.
 */
export function retryDelayMs(
  error: unknown,
  attempt: number,
  baseDelayMs: number,
  random: () => number = Math.random,
): number {
  if (error instanceof DomainError && error.retryAfterSeconds !== undefined) {
    return error.retryAfterSeconds * 1000;
  }
  const ceiling = baseDelayMs * 2 ** (attempt - 1);
  return Math.floor(random() * ceiling);
}
