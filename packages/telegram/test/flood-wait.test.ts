import { describe, expect, it } from "vitest";
import { RPCMessageToError } from "telegram/errors/index.js";

type ServerRpcError = Parameters<typeof RPCMessageToError>[0];
import { RateLimitedError } from "@omnicloud/core";
import { mapTelegramError } from "../src/errors";

/** The error GramJS produces for a real server flood-wait response. */
function floodFromServer(seconds: number) {
  const serverError = { errorMessage: `FLOOD_WAIT_${seconds}`, errorCode: 420 } as ServerRpcError;
  return RPCMessageToError(serverError, undefined as never);
}

describe("Telegram flood waits keep the server's retry delay", () => {
  it("maps a flood wait to RateLimitedError with the delay the server asked for", () => {
    const mapped = mapTelegramError(floodFromServer(30), "fallback");
    expect(mapped).toBeInstanceOf(RateLimitedError);
    expect((mapped as RateLimitedError).retryAfterSeconds).toBe(30);
  });

  it("keeps the delay for a long wait too", () => {
    const mapped = mapTelegramError(floodFromServer(900), "fallback");
    expect((mapped as RateLimitedError).retryAfterSeconds).toBe(900);
  });
});
