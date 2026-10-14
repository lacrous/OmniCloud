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
  const engine = new StorageEngine(provider, { attempts: 1, baseDelayMs: 0 });
  files = new FileService(
    repos.files,
    repos.folders,
    async () => engine,
    new ActivityService(repos.activity),
  );
  user = makeUser();
});

describe("a failed cleanup after a failed commit", () => {
  it("is recorded so the leftover object can be found", async () => {
    repos.files.createWithFirstVersion = async () => {
      throw new Error("simulated commit failure");
    };
    provider.failAllDeletes = true;

    await expect(
      files.upload(user.id, { folderId: null, name: "c.txt", data: Buffer.from("c") }),
    ).rejects.toThrow(/simulated commit failure/);

    const leftovers = repos._activity.filter(
      (e) => e.metadata && (e.metadata as Record<string, unknown>).orphanedObject === true,
    );
    expect(leftovers).toHaveLength(1);
    expect((leftovers[0]!.metadata as Record<string, unknown>).messageId).toBeDefined();
  });

  it("is not recorded when the cleanup succeeds", async () => {
    repos.files.createWithFirstVersion = async () => {
      throw new Error("simulated commit failure");
    };
    await expect(
      files.upload(user.id, { folderId: null, name: "d.txt", data: Buffer.from("d") }),
    ).rejects.toThrow(/simulated commit failure/);

    const leftovers = repos._activity.filter(
      (e) => e.metadata && (e.metadata as Record<string, unknown>).orphanedObject === true,
    );
    expect(leftovers).toHaveLength(0);
    expect(provider.objects.size).toBe(0);
  });
});

describe("a failing activity write does not replace the original error", () => {
  it("still throws the commit error when recording the leftover also fails", async () => {
    repos.files.createWithFirstVersion = async () => {
      throw new Error("simulated commit failure");
    };
    provider.failAllDeletes = true;
    const original = repos.activity.record.bind(repos.activity);
    repos.activity.record = async () => {
      throw new Error("activity store unavailable");
    };
    await expect(
      files.upload(user.id, { folderId: null, name: "e.txt", data: Buffer.from("e") }),
    ).rejects.toThrow(/simulated commit failure/);
    repos.activity.record = original;
  });
});
