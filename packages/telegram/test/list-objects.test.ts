import { describe, expect, it } from "vitest";
import { Api } from "telegram";
import bigInt from "big-integer";
import { TelegramStorageProvider } from "../src/provider";

function documentMessage(id: number, size: number, fileName: string): Api.Message {
  const document = new Api.Document({
    id: bigInt(id),
    accessHash: bigInt(1),
    fileReference: Buffer.alloc(0),
    date: 0,
    mimeType: "application/octet-stream",
    size: bigInt(size),
    dcId: 1,
    attributes: [new Api.DocumentAttributeFilename({ fileName })],
  });
  return new Api.Message({
    id,
    peerId: new Api.PeerChannel({ channelId: bigInt(10) }),
    date: 0,
    message: "",
    media: new Api.MessageMediaDocument({ document }),
  });
}

function textMessage(id: number): Api.Message {
  return new Api.Message({
    id,
    peerId: new Api.PeerChannel({ channelId: bigInt(10) }),
    date: 0,
    message: "hello",
  });
}

function providerWith(messages: unknown[], calls: { limit?: number }[] = []) {
  const client = {
    connected: true,
    iterMessages(_peer: unknown, options: { limit?: number }) {
      calls.push(options);
      return (async function* () {
        for (const message of messages) yield message;
      })();
    },
  };
  return new TelegramStorageProvider(client as never, { chatId: "10", accessHash: "20" });
}

describe("TelegramStorageProvider.listObjects (read-only)", () => {
  it("returns stored documents and skips text messages", async () => {
    const provider = providerWith([
      documentMessage(3, 300, "c.bin"),
      textMessage(2),
      documentMessage(1, 100, "a.bin"),
    ]);
    const objects = await provider.listObjects(10);
    expect(objects.map((o) => o.messageId)).toEqual(["3", "1"]);
    expect(objects[0]).toMatchObject({ name: "c.bin", size: 300 });
  });

  it("stops at the requested limit", async () => {
    const provider = providerWith([
      documentMessage(3, 1, "a"),
      documentMessage(2, 1, "b"),
      documentMessage(1, 1, "c"),
    ]);
    expect(await provider.listObjects(2)).toHaveLength(2);
  });

  it("requests a bounded page from Telegram rather than the whole history", async () => {
    const calls: { limit?: number }[] = [];
    await providerWith([documentMessage(1, 1, "a")], calls).listObjects(5);
    expect(calls[0]!.limit).toBe(10);
  });
});
