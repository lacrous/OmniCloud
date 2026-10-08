import { describe, expect, it } from "vitest";
import { Api } from "telegram";
import bigInt from "big-integer";
import { TelegramFileNotFoundError } from "@omnicloud/core";
import { TelegramStorageProvider } from "../src/provider";

function makeMessage(id: number, size: number): Api.Message {
  const document = new Api.Document({
    id: bigInt(1),
    accessHash: bigInt(2),
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
    message: "",
    media: new Api.MessageMediaDocument({ document }),
  });
}

function fakeClient(options: {
  message?: Api.Message;
  chunks?: Buffer[];
  onIter?: (params: unknown) => void;
}) {
  return {
    connected: true,
    async getMessages() {
      return options.message ? [options.message] : [];
    },
    iterDownload(params: unknown) {
      options.onIter?.(params);
      const chunks = options.chunks ?? [];
      return (async function* () {
        for (const chunk of chunks) yield chunk;
      })();
    },
  };
}

function providerWith(client: ReturnType<typeof fakeClient>) {
  return new TelegramStorageProvider(client as never, {
    chatId: "10",
    accessHash: "20",
  });
}

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for await (const chunk of stream) out.push(Buffer.from(chunk as Uint8Array));
  return out;
}

describe("TelegramStorageProvider.getStream", () => {
  it("yields the object as the chunks Telegram returns, without concatenating them", async () => {
    const pieces = [Buffer.from("alpha-"), Buffer.from("beta-"), Buffer.from("gamma")];
    const size = pieces.reduce((n, p) => n + p.byteLength, 0);
    const provider = providerWith(fakeClient({ message: makeMessage(5, size), chunks: pieces }));

    const stream = await provider.getStream({ messageId: "5" });
    const received = await collect(stream);

    expect(received).toHaveLength(pieces.length);
    expect(Buffer.concat(received).toString()).toBe("alpha-beta-gamma");
  });

  it("requests chunks no larger than Telegram's per-request limit", async () => {
    let params: { requestSize?: number; fileSize?: bigInt.BigInteger } | undefined;
    const provider = providerWith(
      fakeClient({
        message: makeMessage(5, 3),
        chunks: [Buffer.from("abc")],
        onIter: (p) => {
          params = p as typeof params;
        },
      }),
    );

    await collect(await provider.getStream({ messageId: "5" }));

    expect(params?.requestSize).toBe(512 * 1024);
    expect(Number(params?.fileSize?.toString())).toBe(3);
  });

  it("reports progress as chunks arrive", async () => {
    const pieces = [Buffer.alloc(4, 1), Buffer.alloc(4, 2)];
    const provider = providerWith(fakeClient({ message: makeMessage(5, 8), chunks: pieces }));
    const progress: number[] = [];

    await collect(
      await provider.getStream(
        { messageId: "5" },
        { onProgress: (p) => progress.push(p.transferred) },
      ),
    );

    expect(progress).toEqual([0, 4, 8]);
  });

  it("fails before streaming when the message does not exist", async () => {
    const provider = providerWith(fakeClient({}));
    await expect(provider.getStream({ messageId: "404" })).rejects.toBeInstanceOf(
      TelegramFileNotFoundError,
    );
  });
});
