import { describe, expect, it } from "vitest";
import { StorageEngine } from "../src/storage/engine";
import { StorageProviderError } from "../src/errors";
import { sha256Hex } from "../src/utils/hash";
import { FakeStorageProvider } from "./fakes";

describe("StorageEngine", () => {
  it("uploads via the provider and returns the checksum", async () => {
    const provider = new FakeStorageProvider();
    const engine = new StorageEngine(provider);
    const data = Buffer.from("payload");

    const result = await engine.upload({
      name: "a.bin",
      mimeType: "application/octet-stream",
      data,
    });

    expect(result.sha256).toBe(sha256Hex(data));
    expect(result.size).toBe(data.byteLength);
    expect(result.stored.messageId).toMatch(/^\d+$/);
  });

  it("maps provider failures to StorageProviderError", async () => {
    const provider = new FakeStorageProvider();
    provider.failNextPut = true;
    const engine = new StorageEngine(provider);

    await expect(
      engine.upload({ name: "a", mimeType: "x", data: Buffer.from("x") }),
    ).rejects.toThrow(StorageProviderError);
  });

  it("verifies integrity of downloaded data", async () => {
    const provider = new FakeStorageProvider();
    const engine = new StorageEngine(provider);
    const { stored } = await engine.upload({ name: "a", mimeType: "x", data: Buffer.from("abc") });

    const data = await engine.download(stored);
    expect(await engine.verifyIntegrity(data, "deadbeef")).toBe(false);
    expect(await engine.verifyIntegrity(data, sha256Hex(Buffer.from("abc")))).toBe(true);
  });
});
