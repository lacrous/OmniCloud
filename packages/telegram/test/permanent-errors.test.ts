import { describe, expect, it } from "vitest";
import { RPCMessageToError } from "telegram/errors/index.js";
import { mapTelegramError } from "../src/errors";

type ServerRpcError = Parameters<typeof RPCMessageToError>[0];

function rpc(errorMessage: string) {
  return RPCMessageToError({ errorMessage, errorCode: 400 } as ServerRpcError, undefined as never);
}

describe("permanent Telegram errors are not retried", () => {
  it("PEER_ID_INVALID (a stale channel reference) is not retryable", () => {
    const mapped = mapTelegramError(rpc("PEER_ID_INVALID"), "fallback");
    expect(mapped.retryable).toBe(false);
  });

  it("CHAT_WRITE_FORBIDDEN (no permission to write) is not retryable", () => {
    const mapped = mapTelegramError(rpc("CHAT_WRITE_FORBIDDEN"), "fallback");
    expect(mapped.retryable).toBe(false);
  });
});
