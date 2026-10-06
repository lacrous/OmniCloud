import { RPCError } from "telegram/errors/index.js";
import {
  DomainError,
  ForbiddenError,
  RateLimitedError,
  StorageNotInitializedError,
  StorageProviderError,
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
 * appropriate HTTP status and client-facing message.
 */
export function mapTelegramError(error: unknown, fallbackMessage: string): DomainError {
  if (error instanceof DomainError) return error;

  if (isTelegramRpcError(error)) {
    const msg = error.errorMessage ?? "";

    if (msg.startsWith("FLOOD_WAIT_")) {
      const seconds = Number(msg.slice("FLOOD_WAIT_".length)) || 60;
      return new RateLimitedError(`Telegram rate limit reached — retry in ${seconds} seconds`);
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
      case "SESSION_REVOKED":
      case "USER_DEACTIVATED":
        return new UnauthorizedError("The Telegram session is no longer valid — please reconnect");
      case "CHANNEL_PRIVATE":
      case "CHAT_ID_INVALID":
        return new StorageNotInitializedError();
      default:
        return new StorageProviderError(fallbackMessage, {
          code: error.code,
          telegramError: msg,
        });
    }
  }

  return new StorageProviderError(
    error instanceof Error ? `${fallbackMessage}: ${error.message}` : fallbackMessage,
    error,
  );
}
