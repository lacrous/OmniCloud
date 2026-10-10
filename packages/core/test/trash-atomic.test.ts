import { beforeEach, describe, expect, it } from "vitest";
import { ActivityService } from "../src/services/activity-service";
import { FileService } from "../src/services/file-service";
import { FolderService } from "../src/services/folder-service";
import { StorageEngine } from "../src/storage/engine";
import { FakeStorageProvider, createInMemoryRepos, makeUser, type InMemoryRepos } from "./fakes";

let repos: InMemoryRepos;
let folders: FolderService;
let files: FileService;
let user: ReturnType<typeof makeUser>;

beforeEach(() => {
  repos = createInMemoryRepos();
  const provider = new FakeStorageProvider();
  provider.latencyMs = 0;
  const engine = new StorageEngine(provider, { attempts: 1, baseDelayMs: 0 });
  const engineFor = async () => engine;
  const activity = new ActivityService(repos.activity);
  files = new FileService(repos.files, repos.folders, engineFor, activity, repos.uploadOperations);
  folders = new FolderService(repos.folders, repos.files, engineFor, activity);
  user = makeUser();
});

describe("trashing a folder is all-or-nothing", () => {
  it("when the atomic write fails, neither the folder nor its files are trashed", async () => {
    const folder = await folders.create(user.id, { name: "Projects", parentId: null });
    await files.upload(user.id, { folderId: folder.id, name: "a.txt", data: Buffer.from("a") });

    const original = repos.folders.trashSubtree.bind(repos.folders);
    repos.folders.trashSubtree = async () => {
      throw new Error("simulated failure during the trash write");
    };

    await expect(folders.trash(user.id, folder.id)).rejects.toThrow();
    repos.folders.trashSubtree = original;

    expect(repos._folders.find((f) => f.id === folder.id)?.deletedAt).toBeNull();
    expect(repos._files.every((f) => f.deletedAt === null)).toBe(true);
  });

  it("a successful trash stamps the folder and its files with the same batch", async () => {
    const folder = await folders.create(user.id, { name: "Shared", parentId: null });
    await files.upload(user.id, { folderId: folder.id, name: "b.txt", data: Buffer.from("b") });

    await folders.trash(user.id, folder.id);

    const batches = new Set([
      repos._folders.find((f) => f.id === folder.id)?.trashBatchId,
      ...repos._files.map((f) => f.trashBatchId),
    ]);
    expect(batches.size).toBe(1);
    expect(repos._folders.find((f) => f.id === folder.id)?.deletedAt).not.toBeNull();
  });
});
