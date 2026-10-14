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

describe("a new file's metadata commits atomically", () => {
  it("leaves no file row when the commit fails", async () => {
    const original = repos.files.createWithFirstVersion;
    repos.files.createWithFirstVersion = async () => {
      throw new Error("simulated commit failure");
    };
    await expect(
      files.upload(user.id, { folderId: null, name: "p.txt", data: Buffer.from("p") }),
    ).rejects.toThrow();
    repos.files.createWithFirstVersion = original;
    expect(await repos.files.listByUser(user.id)).toHaveLength(0);
  });
});

describe("a new version commits atomically", () => {
  it("keeps the previous version current when the commit fails", async () => {
    const first = await files.upload(user.id, {
      folderId: null,
      name: "v.txt",
      data: Buffer.from("one"),
    });
    const original = repos.files.replaceWithVersion;
    repos.files.replaceWithVersion = async () => {
      throw new Error("simulated commit failure");
    };
    await expect(
      files.upload(user.id, {
        folderId: null,
        name: "v.txt",
        data: Buffer.from("two"),
        replaceFileId: first.id,
      }),
    ).rejects.toThrow();
    repos.files.replaceWithVersion = original;
    const after = await repos.files.findById(first.id);
    expect(after?.sha256).toBe(first.sha256);
    expect(after?.versionCount).toBe(1);
  });
});
