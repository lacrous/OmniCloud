import { describe, expect, it } from "vitest";
import { RPCError } from "telegram/errors/index.js";
import {
  ForbiddenError,
  RateLimitedError,
  StorageNotInitializedError,
  TelegramAuthRequiredError,
  TelegramConnectionError,
  UnauthorizedError,
  ValidationError,
} from "@omnicloud/core";
import { isPasswordRequiredError, mapTelegramError } from "../src/errors";

function rpc(errorMessage: string, code = 400): RPCError {
  return new RPCError(errorMessage, undefined as never, code);
}

describe("mapTelegramError", () => {
  it("maps phone/code errors to validation errors", () => {
    expect(mapTelegramError(rpc("PHONE_NUMBER_INVALID"), "x")).toBeInstanceOf(ValidationError);
    expect(mapTelegramError(rpc("PHONE_CODE_INVALID"), "x")).toBeInstanceOf(ValidationError);
    expect(mapTelegramError(rpc("PHONE_CODE_EXPIRED"), "x")).toBeInstanceOf(ValidationError);
  });

  it("maps 2FA password errors", () => {
    expect(mapTelegramError(rpc("PASSWORD_HASH_INVALID"), "x")).toBeInstanceOf(ValidationError);
    expect(mapTelegramError(rpc("SESSION_PASSWORD_NEEDED"), "x")).toBeInstanceOf(UnauthorizedError);
  });

  it("maps flood waits to rate limiting with the wait time", () => {
    const error = mapTelegramError(rpc("FLOOD_WAIT_42", 420), "x");
    expect(error).toBeInstanceOf(RateLimitedError);
    expect(error.message).toContain("42");
  });

  it("maps revoked sessions to Telegram re-authentication", () => {
    expect(mapTelegramError(rpc("SESSION_REVOKED"), "x")).toBeInstanceOf(
      TelegramAuthRequiredError,
    );
  });

  it("maps inaccessible channels to storage-not-initialized", () => {
    expect(mapTelegramError(rpc("CHANNEL_PRIVATE"), "x")).toBeInstanceOf(
      StorageNotInitializedError,
    );
  });

  it("maps banned numbers to forbidden", () => {
    expect(mapTelegramError(rpc("PHONE_NUMBER_BANNED"), "x")).toBeInstanceOf(ForbiddenError);
  });

  it("wraps unknown RPC errors as connection errors with details", () => {
    const error = mapTelegramError(rpc("SOMETHING_ELSE"), "Telegram upload failed");
    expect(error).toBeInstanceOf(TelegramConnectionError);
    expect(error.status).toBe(502);
    expect(error.details).toMatchObject({ telegramError: "SOMETHING_ELSE" });
  });

  it("wraps non-RPC errors", () => {
    const error = mapTelegramError(new Error("socket hang up"), "Telegram upload failed");
    expect(error).toBeInstanceOf(TelegramConnectionError);
    expect(error.message).toContain("network error");
    expect((error.details as Error).message).toBe("socket hang up");
  });

  it("passes domain errors through untouched", () => {
    const original = new ValidationError("nope");
    expect(mapTelegramError(original, "x")).toBe(original);
  });
});

describe("isPasswordRequiredError", () => {
  it("detects SESSION_PASSWORD_NEEDED", () => {
    expect(isPasswordRequiredError(rpc("SESSION_PASSWORD_NEEDED"))).toBe(true);
    expect(isPasswordRequiredError(rpc("PHONE_CODE_INVALID"))).toBe(false);
    expect(isPasswordRequiredError(new Error("boom"))).toBe(false);
  });
});
