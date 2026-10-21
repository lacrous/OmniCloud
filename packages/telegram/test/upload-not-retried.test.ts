import { describe, expect, it } from "vitest";
import { StorageEngine, TelegramConnectionError } from "@omnicloud/core";
import { TelegramStorageProvider } from "../src/provider";

const input = {
  name: "a.bin",
  mimeType: "application/octet-stream" as const,
  data: Buffer.from("abc"),
  sha256: "a".repeat(64),
  caption: `${"a".repeat(64)}:op_0001`,
};

describe("an upload failure is classified by whether it may have been stored", () => {
  it("a lost response is not retryable, because Telegram may have stored the object", async () => {
    const client = {
      connected: true,
      async sendFile() {
        throw Object.assign(new Error("socket hang up"), { code: 500 });
      },
    };
    const provider = new TelegramStorageProvider(client as never, {
      chatId: "10",
      accessHash: "20",
    });

    const failure = await provider.put(input).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(TelegramConnectionError);
    expect((failure as TelegramConnectionError).retryable).toBe(false);
  });

  it("the engine does not re-send after a lost response, so only one object is stored", async () => {
    let sent = 0;
    const client = {
      connected: true,
      async sendFile() {
        sent += 1;
        throw Object.assign(new Error("socket hang up"), { code: 500 });
      },
    };
    const provider = new TelegramStorageProvider(client as never, {
      chatId: "10",
      accessHash: "20",
    });
    // Production policy: three attempts.
    const engine = new StorageEngine(provider, { attempts: 3, baseDelayMs: 0 });

    await engine.upload(input).catch(() => undefined);
    expect(sent).toBe(1);
  });
});
