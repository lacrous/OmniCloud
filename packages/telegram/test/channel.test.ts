import { describe, expect, it } from "vitest";
import { Api } from "telegram";
import bigInt from "big-integer";
import { StorageProviderError } from "@omnicloud/core";
import { extractCreatedChannel } from "../src/client";

describe("extractCreatedChannel", () => {
  it("finds the created channel in an Updates response", () => {
    const channel = new Api.Channel({
      id: bigInt(1234567890),
      accessHash: bigInt("987654321"),
      title: "OmniCloud Storage",
      photo: new Api.ChatPhotoEmpty(),
      date: 1700000000,
    });
    const updates = new Api.Updates({
      updates: [],
      chats: [channel],
      users: [],
      date: 1700000000,
      seq: 1,
    });

    const result = extractCreatedChannel(updates);

    expect(result).toBe(channel);
    expect(result.id.toString()).toBe("1234567890");
    expect(result.accessHash?.toString()).toBe("987654321");
  });

  it("throws when no channel is present", () => {
    const updates = new Api.Updates({
      updates: [],
      chats: [],
      users: [],
      date: 1700000000,
      seq: 1,
    });
    expect(() => extractCreatedChannel(updates)).toThrow(StorageProviderError);
  });
});
