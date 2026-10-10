import { beforeEach, describe, expect, it } from "vitest";
import { ActivityService } from "../src/services/activity-service";
import { FileService } from "../src/services/file-service";
import { StorageEngine } from "../src/storage/engine";
import { FakeStorageProvider, createInMemoryRepos, makeUser, type InMemoryRepos } from "./fakes";

let repos: InMemoryRepos;
let provider: FakeStorageProvider;
let files: FileService;
let user: ReturnType<typeof makeUser>;

beforeEach(() => {
  repos = createInMemoryRepos();
  provider = new FakeStorageProvider();
  provider.latencyMs = 0;
  const engine = new StorageEngine(provider, { attempts: 1, baseDelayMs: 0 });
  const engineFor = async () => engine;
  files = new FileService(
    repos.files,
    repos.folders,
    engineFor,
    new ActivityService(repos.activity),
    repos.uploadOperations,
  );
  user = makeUser();
});

describe("an upload whose Telegram outcome is unknown", () => {
  it("is recorded as UNKNOWN, not FAILED, so it is never treated as a clean retry", async () => {
    const original = provider.put.bind(provider);
    provider.put = async (input, control) => {
      await original(input, control);
      const { TelegramConnectionError } = await import("@omnicloud/core");
      throw new TelegramConnectionError("Telegram response was lost after the write");
    };

    await expect(
      files.upload(user.id, {
        folderId: null,
        name: "u.txt",
        data: Buffer.from("u"),
        operationId: "ambiguous_0001",
      }),
    ).rejects.toThrow();
    provider.put = original;

    const op = repos._uploadOperations.find((o) => o.operationId === "ambiguous_0001");
    expect(op?.status).toBe("UNKNOWN");
  });
});

describe("ordinary failures and unknown outcomes stay distinct", () => {
  it("a failure known to precede the write is still FAILED, so a retry remains possible", async () => {
    provider.failAllPuts = true;
    await expect(
      files.upload(user.id, {
        folderId: null,
        name: "f.txt",
        data: Buffer.from("f"),
        operationId: "failed_0002",
      }),
    ).rejects.toThrow();
    provider.failAllPuts = false;
    expect(repos._uploadOperations.find((o) => o.operationId === "failed_0002")?.status).toBe(
      "FAILED",
    );
  });

  it("an UNKNOWN operation is not claimed by a new request, so it is never silently re-uploaded", async () => {
    const op = await repos.uploadOperations.create({
      userId: user.id,
      operationId: "unknown_0003",
    });
    await repos.uploadOperations.claim(op.id, "PENDING", "UPLOADING");
    await repos.uploadOperations.claim(op.id, "UPLOADING", "UNKNOWN");
    const before = provider.putCalls;

    await expect(
      files.upload(user.id, {
        folderId: null,
        name: "g.txt",
        data: Buffer.from("g"),
        operationId: "unknown_0003",
      }),
    ).rejects.toThrow();

    expect(provider.putCalls).toBe(before);
  });
});
