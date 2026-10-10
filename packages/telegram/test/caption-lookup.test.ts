import { describe, expect, it } from "vitest";
import { Api } from "telegram";
import bigInt from "big-integer";
import { TelegramStorageProvider } from "../src/provider";

const SHA = "a".repeat(64);

function documentMessage(id: number, size: number, caption: string): Api.Message {
  const document = new Api.Document({
    id: bigInt(id),
    accessHash: bigInt(1),
    fileReference: Buffer.alloc(0),
    date: 0,
    mimeType: "application/octet-stream",
    size: bigInt(size),
    dcId: 1,
    attributes: [new Api.DocumentAttributeFilename({ fileName: "f.bin" })],
  });
  return new Api.Message({
    id,
    peerId: new Api.PeerChannel({ channelId: bigInt(10) }),
    date: 0,
    message: caption,
    media: new Api.MessageMediaDocument({ document }),
  });
}

function providerWith(options: {
  messages?: unknown[];
  sent?: { caption?: string }[];
  searches?: { search?: string }[];
}) {
  const client = {
    connected: true,
    async sendFile(_peer: unknown, sendOptions: { caption?: string }) {
      options.sent?.push(sendOptions);
      return documentMessage(9, 3, sendOptions.caption ?? "");
    },
    iterMessages(_peer: unknown, iterOptions: { search?: string }) {
      options.searches?.push(iterOptions);
      const messages = options.messages ?? [];
      return (async function* () {
        for (const message of messages) yield message;
      })();
    },
  };
  return new TelegramStorageProvider(client as never, { chatId: "10", accessHash: "20" });
}

describe("TelegramStorageProvider uploads carry the content hash as a caption", () => {
  it("sends the caption so an unknown upload can be found later", async () => {
    const sent: { caption?: string }[] = [];
    const provider = providerWith({ sent });
    await provider.put({
      name: "a.bin",
      mimeType: "application/octet-stream",
      data: Buffer.from("abc"),
      sha256: SHA,
    });
    expect(sent[0]!.caption).toBe(SHA);
  });
});

describe("TelegramStorageProvider.findByCaption", () => {
  it("returns only messages whose caption equals the hash and whose size matches", async () => {
    const searches: { search?: string }[] = [];
    const provider = providerWith({
      searches,
      messages: [
        documentMessage(5, 3, SHA),
        documentMessage(4, 9, SHA),
        documentMessage(3, 3, "b".repeat(64)),
      ],
    });
    const found = await provider.findByCaption(SHA, 3);
    expect(found.map((o) => o.messageId)).toEqual(["5"]);
    expect(searches[0]!.search).toBe(SHA);
  });

  it("returns an empty list when nothing matches", async () => {
    const provider = providerWith({ messages: [documentMessage(1, 3, "other")] });
    expect(await provider.findByCaption(SHA, 3)).toEqual([]);
  });
});
