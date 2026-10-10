import { describe, expect, it } from "vitest";
import { Api } from "telegram";
import bigInt from "big-integer";
import { TelegramConnectionService } from "../src/connection";

function createdChannel() {
  return new Api.Channel({
    id: bigInt(1234567890),
    accessHash: bigInt("987654321"),
    title: "OmniCloud Storage",
    photo: new Api.ChatPhotoEmpty(),
    date: 1700000000,
  });
}

function fakeClient(options: { failPhoto?: boolean; failArchive?: boolean } = {}) {
  const calls: string[] = [];
  const channel = createdChannel();
  return {
    calls,
    client: {
      connected: true,
      async invoke(request: unknown) {
        if (request instanceof Api.channels.CreateChannel) {
          calls.push("create");
          return new Api.Updates({ updates: [], chats: [channel], users: [], date: 1, seq: 1 });
        }
        if (request instanceof Api.channels.EditPhoto) {
          calls.push("photo");
          if (options.failPhoto) throw new Error("photo refused");
          return new Api.Updates({ updates: [], chats: [], users: [], date: 1, seq: 1 });
        }
        if (request instanceof Api.folders.EditPeerFolders) {
          calls.push("archive");
          if (options.failArchive) throw new Error("archive refused");
          return new Api.Updates({ updates: [], chats: [], users: [], date: 1, seq: 1 });
        }
        throw new Error("unexpected request");
      },
      async uploadFile() {
        calls.push("upload");
        return new Api.InputFile({ id: bigInt(1), parts: 1, name: "logo.png", md5Checksum: "" });
      },
    },
  };
}

function serviceWith(repo: Record<string, unknown> = {}) {
  const storages = {
    findByUserAndProvider: async () => null,
    create: async (input: Record<string, unknown>) => ({ id: "s1", ...input }),
    ...repo,
  };
  return new TelegramConnectionService(
    { storages, sessions: {}, users: {} } as never,
    {} as never,
    { apiId: 1, apiHash: "h" },
  );
}

describe("a new storage channel is branded and archived", () => {
  it("sets the logo, then archives the channel, after creating it", async () => {
    const { client, calls } = fakeClient();
    await serviceWith().ensureStorageForClient("u1", client as never);
    expect(calls).toEqual(["create", "upload", "photo", "archive"]);
  });

  it("still creates the storage record when setting the logo fails", async () => {
    const { client, calls } = fakeClient({ failPhoto: true });
    const record = await serviceWith().ensureStorageForClient("u1", client as never);
    expect(record.telegramChatId).toBe("1234567890");
    expect(calls).toContain("archive");
  });

  it("still creates the storage record when archiving fails", async () => {
    const { client, calls } = fakeClient({ failArchive: true });
    const record = await serviceWith().ensureStorageForClient("u1", client as never);
    expect(record.telegramChatId).toBe("1234567890");
    expect(calls).toEqual(["create", "upload", "photo", "archive"]);
  });
});
