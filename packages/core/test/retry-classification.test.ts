import { describe, expect, it } from "vitest";
import { RateLimitedError, TelegramConnectionError, UploadFailedError } from "../src/errors";
import { isRetryableError } from "../src/storage/retry";

describe("retry classification", () => {
  it("retries a flood wait and exposes the exact delay", () => {
    const error = new RateLimitedError("Telegram rate limit reached", { retryAfterSeconds: 30 });
    expect(isRetryableError(error)).toBe(true);
    expect(error.retryAfterSeconds).toBe(30);
  });

  it("retries transient connection errors", () => {
    expect(isRetryableError(new TelegramConnectionError("socket hang up"))).toBe(true);
  });

  it("never retries an error that is not explicitly marked retryable", () => {
    expect(isRetryableError(new UploadFailedError("bad input"))).toBe(false);
  });

  it("decides from the error type, not from the message text", () => {
    const misleading = new TelegramConnectionError("password invalid flood_wait phone");
    expect(isRetryableError(misleading)).toBe(true);
    const plainWithRetryWords = new Error("timeout ECONNRESET FLOOD_WAIT_30");
    expect(isRetryableError(plainWithRetryWords)).toBe(false);
  });

  it("does not retry cancellation or aborts", () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(isRetryableError(abort)).toBe(false);
  });
});
