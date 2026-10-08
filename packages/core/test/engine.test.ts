import { describe, expect, it } from "vitest";
import { StorageEngine } from "../src/storage/engine";
import { OperationCancelledError, UploadFailedError } from "../src/errors";
import { sha256Hex } from "../src/utils/hash";
import { FakeStorageProvider } from "./fakes";

describe("StorageEngine upload", () => {
  it("uploads and returns the checksum and size", async () => {
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

  it("reports progress reaching 100%", async () => {
    const provider = new FakeStorageProvider();
    const engine = new StorageEngine(provider);
    const seen: number[] = [];

    await engine.upload(
      { name: "a.bin", mimeType: "x", data: Buffer.alloc(1024) },
      { onProgress: (p) => seen.push(p.percent ?? -1) },
    );

    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(100);
  });

  it("retries transient failures and eventually succeeds", async () => {
    const provider = new FakeStorageProvider();
    provider.transientPutFailures = 2; // succeeds on the 3rd attempt
    const engine = new StorageEngine(provider, { attempts: 3, baseDelayMs: 1 });

    await engine.upload({ name: "a.bin", mimeType: "x", data: Buffer.from("x") });

    expect(provider.putCalls).toBe(3);
  });

  it("gives up after exhausting the retry budget", async () => {
    const provider = new FakeStorageProvider();
    provider.transientPutFailures = 10;
    const engine = new StorageEngine(provider, { attempts: 3, baseDelayMs: 1 });

    await expect(
      engine.upload({ name: "a.bin", mimeType: "x", data: Buffer.from("x") }),
    ).rejects.toThrow(UploadFailedError);
    expect(provider.putCalls).toBe(3);
  });

  it("does not retry non-transient errors", async () => {
    const provider = new FakeStorageProvider();
    provider.failAllPuts = true;
    const engine = new StorageEngine(provider, { attempts: 5, baseDelayMs: 1 });

    // "invalid upload (non-retryable)" matches the non-retry policy.
    await expect(
      engine.upload({ name: "a.bin", mimeType: "x", data: Buffer.from("x") }),
    ).rejects.toThrow();
    expect(provider.putCalls).toBe(1);
  });

  it("honors cancellation before starting", async () => {
    const provider = new FakeStorageProvider();
    const engine = new StorageEngine(provider);
    const controller = new AbortController();
    controller.abort();

    await expect(
      engine.upload(
        { name: "a.bin", mimeType: "x", data: Buffer.from("x") },
        { signal: controller.signal },
      ),
    ).rejects.toThrow(OperationCancelledError);
    expect(provider.putCalls).toBe(0);
  });
});

describe("StorageEngine download / integrity", () => {
  it("downloads and verifies integrity", async () => {
    const provider = new FakeStorageProvider();
    const engine = new StorageEngine(provider);
    const { stored } = await engine.upload({
      name: "a",
      mimeType: "x",
      data: Buffer.from("abc"),
    });

    const data = await engine.download(stored);
    expect(await engine.verifyIntegrity(data, sha256Hex(Buffer.from("abc")))).toBe(true);
    expect(await engine.verifyIntegrity(data, "deadbeef")).toBe(false);
  });

  it("maps provider failures to a download error", async () => {
    const provider = new FakeStorageProvider();
    const engine = new StorageEngine(provider, { attempts: 1, baseDelayMs: 1 });
    provider.failNextGet = true;

    await expect(engine.download({ messageId: "1" })).rejects.toThrow();
  });

  it("reports storage health, including failures", async () => {
    const provider = new FakeStorageProvider();
    const engine = new StorageEngine(provider);

    expect(await engine.health()).toMatchObject({ healthy: true, targetTitle: "Fake Storage" });

    provider.healthResult = "unhealthy";
    expect(await engine.health()).toMatchObject({ healthy: false });
  });
});
