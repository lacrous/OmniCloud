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

describe("replace racing a permanent delete", () => {
  it("does not leave the newly uploaded object behind when the file is deleted mid-replace", async () => {
    const original = await files.upload(user.id, {
      folderId: null,
      name: "v.txt",
      data: Buffer.from("one"),
    });
    const beforeObjects = new Set(provider.objects.keys());

    // The file is permanently deleted while the replacement is being uploaded.
    const realPut = provider.put.bind(provider);
    provider.put = async (input, control) => {
      const stored = await realPut(input, control);
      await files.trash(user.id, original.id);
      await files.deletePermanently(user.id, original.id);
      return stored;
    };

    await expect(
      files.upload(user.id, {
        folderId: null,
        name: "v.txt",
        data: Buffer.from("two"),
        replaceFileId: original.id,
      }),
    ).rejects.toThrow();

    const newObjects = [...provider.objects.keys()].filter((key) => !beforeObjects.has(key));
    expect(newObjects).toEqual([]);
  });
});

describe("failed commit of a new file", () => {
  it("removes the stored object when the file record cannot be written", async () => {
    const realCreate = repos.files.create.bind(repos.files);
    repos.files.create = async () => {
      throw new Error("simulated database failure");
    };

    await expect(
      files.upload(user.id, { folderId: null, name: "n.txt", data: Buffer.from("new") }),
    ).rejects.toThrow(/simulated database failure/);

    expect(provider.objects.size).toBe(0);
    repos.files.create = realCreate;
  });
});
