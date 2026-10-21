import { describe, expect, it } from "vitest";
import { TelegramStorageProvider } from "../src/provider";

function provider() {
  const client = {
    connected: true,
    async sendFile() {
      throw new Error("the upload should not have been attempted");
    },
  };
  return new TelegramStorageProvider(client as never, { chatId: "10", accessHash: "20" });
}

describe("an upload input that is missing a piece", () => {
  it("says so when there is neither data nor a path", async () => {
    const failure = await provider()
      .put({ name: "a.bin", mimeType: "application/octet-stream" })
      .catch((e: unknown) => e);

    expect((failure as Error).message).toMatch(/neither data nor a spooled file/i);
  });

  it("says the size is missing when a path is given without one", async () => {
    // The message must not claim that no file was supplied: a path was, and
    // the size is what is missing.
    const failure = await provider()
      .put({
        name: "a.bin",
        mimeType: "application/octet-stream",
        path: "/tmp/spooled.bin",
      })
      .catch((e: unknown) => e);

    expect((failure as Error).message).toMatch(/must include its size/i);
    expect((failure as Error).message).not.toMatch(/neither data nor a spooled file/i);
  });
});
