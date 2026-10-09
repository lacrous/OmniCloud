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

describe("upload idempotency keys are bound to the original request", () => {
  it("a replay with different content under the same key is rejected, not silently answered", async () => {
    const key = "fingerprint_0001";
    await files.upload(user.id, {
      folderId: null,
      name: "a.txt",
      data: Buffer.from("original"),
      operationId: key,
    });

    await expect(
      files.upload(user.id, {
        folderId: null,
        name: "a.txt",
        data: Buffer.from("DIFFERENT"),
        operationId: key,
      }),
    ).rejects.toThrow(/operation id|different|conflict/i);
  });

  it("a replay with a different name under the same key is rejected", async () => {
    const key = "fingerprint_0002";
    await files.upload(user.id, {
      folderId: null,
      name: "a.txt",
      data: Buffer.from("same"),
      operationId: key,
    });

    await expect(
      files.upload(user.id, {
        folderId: null,
        name: "b.txt",
        data: Buffer.from("same"),
        operationId: key,
      }),
    ).rejects.toThrow(/operation id|different|conflict/i);
  });

  it("an identical replay still returns the original file", async () => {
    const key = "fingerprint_0003";
    const first = await files.upload(user.id, {
      folderId: null,
      name: "a.txt",
      data: Buffer.from("same"),
      operationId: key,
    });
    const again = await files.upload(user.id, {
      folderId: null,
      name: "a.txt",
      data: Buffer.from("same"),
      operationId: key,
    });
    expect(again.id).toBe(first.id);
    expect(repos._files.filter((f) => f.userId === user.id)).toHaveLength(1);
  });
});
