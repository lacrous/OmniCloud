import { describe, expect, it } from "vitest";
import { RateLimitedError, UploadFailedError } from "../src/errors";
import { StorageEngine } from "../src/storage/engine";
import { retryDelayMs } from "../src/storage/retry";
import { FakeStorageProvider } from "./fakes";

describe("retry delay policy", () => {
  it("waits exactly the flood-wait the server asked for", () => {
    const error = new RateLimitedError("rate", { retryAfterSeconds: 30 });
    expect(retryDelayMs(error, 1, 400)).toBe(30_000);
    expect(retryDelayMs(error, 3, 400)).toBe(30_000);
  });

  it("backs off exponentially with jitter bounded by the ceiling", () => {
    const error = new Error("transient");
    expect(retryDelayMs(error, 1, 400, () => 0.999)).toBeLessThan(400);
    expect(retryDelayMs(error, 2, 400, () => 0.999)).toBeLessThan(800);
    expect(retryDelayMs(error, 3, 400, () => 0.999)).toBeLessThan(1600);
    expect(retryDelayMs(error, 2, 400, () => 0)).toBe(0);
  });
});

describe("StorageEngine retry behaviour", () => {
  it("never retries a permanent error", async () => {
    const provider = new FakeStorageProvider();
    provider.failAllPuts = true; // throws a plain, non-retryable error
    const engine = new StorageEngine(provider, { attempts: 5, baseDelayMs: 0 });

    await expect(
      engine.upload({ name: "a.bin", mimeType: "x", data: Buffer.from("x") }),
    ).rejects.toBeInstanceOf(UploadFailedError);
    expect(provider.putCalls).toBe(1);
  });

  it("retries a flood wait instead of failing the upload", async () => {
    const provider = new FakeStorageProvider();
    let calls = 0;
    const original = provider.put.bind(provider);
    provider.put = async (input, control) => {
      calls += 1;
      if (calls === 1) throw new RateLimitedError("rate", { retryAfterSeconds: 0 });
      return original(input, control);
    };
    const engine = new StorageEngine(provider, { attempts: 3, baseDelayMs: 1 });

    await engine.upload({ name: "a.bin", mimeType: "x", data: Buffer.from("x") });
    expect(calls).toBe(2);
  });
});
