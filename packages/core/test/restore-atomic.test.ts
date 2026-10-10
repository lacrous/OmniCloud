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

describe("restoring a folder is all-or-nothing", () => {
  it("when the restore write fails, the folder and its files stay in the Trash together", async () => {
    const folder = await folders.create(user.id, { name: "Back", parentId: null });
    await files.upload(user.id, { folderId: folder.id, name: "c.txt", data: Buffer.from("c") });
    await folders.trash(user.id, folder.id);

    const original = repos.folders.restoreSubtree.bind(repos.folders);
    repos.folders.restoreSubtree = async () => {
      throw new Error("simulated failure during the restore write");
    };

    await expect(folders.restore(user.id, folder.id)).rejects.toThrow();
    repos.folders.restoreSubtree = original;

    expect(repos._folders.find((f) => f.id === folder.id)?.deletedAt).not.toBeNull();
    expect(repos._files.every((f) => f.deletedAt !== null)).toBe(true);
  });
});
