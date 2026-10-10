import { beforeEach, describe, expect, it } from "vitest";
import { ActivityService } from "../src/services/activity-service";
import { FileService } from "../src/services/file-service";
import { FolderService } from "../src/services/folder-service";
import { StorageEngine } from "../src/storage/engine";
import { FakeStorageProvider, createInMemoryRepos, makeUser, type InMemoryRepos } from "./fakes";

let repos: InMemoryRepos;
let provider: FakeStorageProvider;
let folders: FolderService;
let files: FileService;
let user: ReturnType<typeof makeUser>;

beforeEach(() => {
  repos = createInMemoryRepos();
  provider = new FakeStorageProvider();
  provider.latencyMs = 0;
  const engine = new StorageEngine(provider, { attempts: 1, baseDelayMs: 0 });
  const engineFor = async () => engine;
  const activity = new ActivityService(repos.activity);
  files = new FileService(repos.files, repos.folders, engineFor, activity, repos.uploadOperations);
  folders = new FolderService(repos.folders, repos.files, engineFor, activity);
  user = makeUser();
});

describe("permanently deleting a folder removes every Telegram object it created", () => {
  it("removes the old versions' Telegram messages too, not only the current one", async () => {
    const folder = await folders.create(user.id, { name: "Archive", parentId: null });
    const created = await files.upload(user.id, {
      folderId: folder.id,
      name: "doc.txt",
      data: Buffer.from("v1"),
    });
    await files.upload(user.id, {
      folderId: folder.id,
      name: "doc.txt",
      data: Buffer.from("v2"),
      replaceFileId: created.id,
    });
    expect(provider.objects.size).toBe(2);

    await folders.deletePermanently(user.id, folder.id);

    expect(provider.objects.size).toBe(0);
    expect(repos._versions.filter((v) => v.fileId === created.id)).toHaveLength(0);
  });
});
