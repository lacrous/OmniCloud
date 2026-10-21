import { beforeEach, describe, expect, it } from "vitest";
import { ActivityService } from "../src/services/activity-service";
import { FileService } from "../src/services/file-service";
import { FolderService } from "../src/services/folder-service";
import { StorageEngine } from "../src/storage/engine";
import { FakeStorageProvider, createInMemoryRepos, makeUser, type InMemoryRepos } from "./fakes";

let repos: InMemoryRepos;
let provider: FakeStorageProvider;
let files: FileService;
let folders: FolderService;
let owner: ReturnType<typeof makeUser>;
let stranger: ReturnType<typeof makeUser>;

beforeEach(() => {
  repos = createInMemoryRepos();
  provider = new FakeStorageProvider();
  const engine = new StorageEngine(provider, { attempts: 1, baseDelayMs: 0 });
  const engineFor = async () => engine;
  const activity = new ActivityService(repos.activity);
  files = new FileService(repos.files, repos.folders, engineFor, activity);
  folders = new FolderService(repos.folders, repos.files, engineFor, activity);
  owner = makeUser();
  stranger = makeUser();
});

/** A folder owned by `owner` with one file inside it. */
async function ownedSubtree() {
  const folder = await folders.create(owner.id, { name: "theirs", parentId: null });
  const file = await files.upload(owner.id, {
    folderId: folder.id,
    name: "secret.txt",
    data: Buffer.from("secret"),
  });
  return { folder, file };
}

describe("subtree trash and restore are scoped to the owner", () => {
  it("does not trash another account's folder or file when asked directly", async () => {
    const { folder, file } = await ownedSubtree();
    const stamp = { deletedAt: new Date(), trashBatchId: "batch-1" };

    // A caller that knows the ids of another account's items must not be able
    // to trash them. The service layer already checks ownership; this proves
    // the repository write is scoped too, so a bug in a future caller cannot
    // reach another account's data.
    await repos.folders.trashSubtree(stranger.id, [folder.id], [file.id], stamp);

    const folderRow = repos._folders.find((f) => f.id === folder.id)!;
    const fileRow = repos._files.find((f) => f.id === file.id)!;
    expect(folderRow.deletedAt).toBeNull();
    expect(fileRow.deletedAt).toBeNull();
  });

  it("does not restore another account's trashed folder or file when asked directly", async () => {
    const { folder, file } = await ownedSubtree();
    const stamp = { deletedAt: new Date(), trashBatchId: "batch-1" };
    await repos.folders.trashSubtree(owner.id, [folder.id], [file.id], stamp);
    expect(repos._folders.find((f) => f.id === folder.id)!.deletedAt).not.toBeNull();

    await repos.folders.restoreSubtree(stranger.id, [folder.id], [file.id], {
      rootId: folder.id,
      reparent: null,
    });

    expect(repos._folders.find((f) => f.id === folder.id)!.deletedAt).not.toBeNull();
    expect(repos._files.find((f) => f.id === file.id)!.deletedAt).not.toBeNull();
  });

  it("still trashes and restores the owner's own subtree", async () => {
    const { folder, file } = await ownedSubtree();
    const stamp = { deletedAt: new Date(), trashBatchId: "batch-1" };

    await repos.folders.trashSubtree(owner.id, [folder.id], [file.id], stamp);
    expect(repos._folders.find((f) => f.id === folder.id)!.deletedAt).not.toBeNull();
    expect(repos._files.find((f) => f.id === file.id)!.deletedAt).not.toBeNull();

    await repos.folders.restoreSubtree(owner.id, [folder.id], [file.id], {
      rootId: folder.id,
      reparent: null,
    });
    expect(repos._folders.find((f) => f.id === folder.id)!.deletedAt).toBeNull();
    expect(repos._files.find((f) => f.id === file.id)!.deletedAt).toBeNull();
  });

  it("does not reparent another account's folder", async () => {
    const { folder } = await ownedSubtree();
    const target = await folders.create(owner.id, { name: "target", parentId: null });

    await repos.folders.restoreSubtree(stranger.id, [folder.id], [], {
      rootId: folder.id,
      reparent: { parentId: target.id },
    });

    expect(repos._folders.find((f) => f.id === folder.id)!.parentId).toBeNull();
  });

  it("the service refuses another account's folder outright", async () => {
    const { folder } = await ownedSubtree();

    // The service layer is the first line of defence and already checks.
    await expect(folders.trash(stranger.id, folder.id)).rejects.toThrow(/not found/i);
    expect(repos._folders.find((f) => f.id === folder.id)!.deletedAt).toBeNull();
  });
});
