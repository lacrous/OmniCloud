import { describe, expect, it } from "vitest";
import { RPCMessageToError } from "telegram/errors/index.js";
import { TelegramStorageProvider } from "../src/provider";

type ServerRpcError = Parameters<typeof RPCMessageToError>[0];

/** A client whose deleteMessages fails the way Telegram does for a message already gone. */
function clientFailingWith(errorMessage: string) {
  const serverError = { errorMessage, errorCode: 400 } as ServerRpcError;
  const error = RPCMessageToError(serverError, undefined as never);
  return {
    deleteMessages: async () => {
      throw error;
    },
  };
}

function providerWith(client: unknown) {
  return new TelegramStorageProvider(
    client as never,
    {
      chatId: "-1001234567890",
      accessHash: "987654321",
    } as never,
  );
}

describe("deleting an object that is already gone", () => {
  it("does not throw, because the storage contract says a missing object is already deleted", async () => {
    const provider = providerWith(clientFailingWith("MSG_ID_INVALID"));
    await expect(provider.delete({ messageId: "42" })).resolves.toBeUndefined();
  });

  it("still reports a real failure, such as a network error, rather than hiding it", async () => {
    const provider = providerWith({
      deleteMessages: async () => {
        throw new Error("socket closed");
      },
    });
    await expect(provider.delete({ messageId: "42" })).rejects.toThrow();
  });
});
