import { RPCError } from "telegram/errors/index.js";
import {
  DomainError,
  ForbiddenError,
  RateLimitedError,
  StorageNotInitializedError,
  TelegramAuthRequiredError,
  TelegramConnectionError,
  TelegramFileNotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@omnicloud/core";

export function isTelegramRpcError(error: unknown): error is RPCError {
  return error instanceof RPCError;
}

/** True when the error signals that 2FA password auth is required. */
export function isPasswordRequiredError(error: unknown): boolean {
  return isTelegramRpcError(error) && error.errorMessage === "SESSION_PASSWORD_NEEDED";
}

/**
 * Maps a Telegram (GramJS) failure to a structured domain error with an
 * appropriate HTTP status and a client-facing message that never leaks
 * credentials or session material.
 */
export function mapTelegramError(error: unknown, fallbackMessage: string): DomainError {
  if (error instanceof DomainError) return error;

  if (isTelegramRpcError(error)) {
    const msg = error.errorMessage ?? "";

    // GramJS reports a flood wait as errorMessage "FLOOD" and carries the server's
    // delay in `seconds`, so read that first. The prefix check only covers raw text.
    const seconds = (error as unknown as { seconds?: unknown }).seconds;
    const floodSeconds =
      typeof seconds === "number"
        ? seconds
        : msg.startsWith("FLOOD_WAIT_")
          ? Number(msg.slice("FLOOD_WAIT_".length))
          : null;
    if (msg.startsWith("FLOOD") && floodSeconds !== null && floodSeconds > 0) {
      return new RateLimitedError(
        `Telegram rate limit reached — retry in ${floodSeconds} seconds`,
        {
          retryAfterSeconds: floodSeconds,
        },
      );
    }

    switch (msg) {
      case "PHONE_NUMBER_INVALID":
        return new ValidationError("This phone number is not valid");
      case "PHONE_NUMBER_UNOCCUPIED":
        return new ValidationError("No Telegram account exists for this phone number");
      case "PHONE_CODE_INVALID":
        return new ValidationError("Invalid confirmation code");
      case "PHONE_CODE_EXPIRED":
        return new ValidationError("The confirmation code has expired — request a new one");
      case "PHONE_CODE_EMPTY":
        return new ValidationError("Please enter the confirmation code");
      case "SESSION_PASSWORD_NEEDED":
        return new UnauthorizedError("Two-factor authentication is enabled on this account");
      case "PASSWORD_HASH_INVALID":
        return new ValidationError("Incorrect two-factor password");
      case "PHONE_NUMBER_BANNED":
        return new ForbiddenError("This phone number is banned from Telegram");
      case "AUTH_KEY_UNREGISTERED":
      case "AUTH_KEY_DUPLICATED":
      case "SESSION_REVOKED":
      case "SESSION_EXPIRED":
      case "USER_DEACTIVATED":
      case "USER_DEACTIVATED_BAN":
        return new TelegramAuthRequiredError();
      case "CHANNEL_PRIVATE":
      case "CHANNEL_INVALID":
      case "CHAT_ID_INVALID":
        return new StorageNotInitializedError();
      case "MSG_ID_INVALID":
      case "MESSAGE_ID_INVALID":
        return new TelegramFileNotFoundError();
      case "FILE_REFERENCE_EXPIRED":
      case "FILE_REFERENCE_INVALID":
        return new TelegramFileNotFoundError(
          "The Telegram file reference expired — re-upload the file to refresh it",
        );
      default:
        return new TelegramConnectionError(fallbackMessage, {
          code: error.code,
          telegramError: msg,
        });
    }
  }

  const detail = error instanceof Error ? error.message : String(error);
  // Network-shaped failures get the connection error code so the UI can offer
  // a retry rather than implying the request was invalid.
  if (/timeout|ECONNRESET|ENOTFOUND|socket|network|connect/i.test(detail)) {
    return new TelegramConnectionError(`${fallbackMessage} (network error)`, error);
  }
  return new TelegramConnectionError(
    detail ? `${fallbackMessage}: ${detail}` : fallbackMessage,
    error,
  );
}
