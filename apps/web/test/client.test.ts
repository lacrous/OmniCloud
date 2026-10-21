import { describe, expect, it } from "vitest";
import { api, ApiError, ERROR_CODES } from "../src/api/client";

describe("files.download outside a browser", () => {
  it("fails with a clear message instead of 'document is not defined'", () => {
    // These tests run in Node, where there is no DOM. The helper needs one to
    // click a link in, so it must say so in a way a caller can act on.
    expect(typeof document).toBe("undefined");

    let thrown: unknown = null;
    try {
      api.files.download("f1");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    const error = thrown as ApiError;
    expect(error.code).toBe("NO_DOM");
    expect(error.message).toMatch(/needs a browser/i);
    expect(error.message).not.toMatch(/document is not defined/i);
  });
});

describe("the shared error codes are used, not literals", () => {
  it("exposes the Telegram auth code the client checks for", () => {
    // The client's reconnect logic compares against this constant. If the
    // canonical code changed, a literal comparison would silently stop
    // recognising a Telegram-auth failure.
    expect(ERROR_CODES.TELEGRAM_AUTH_REQUIRED).toBe("TELEGRAM_AUTH_REQUIRED");
  });
});
