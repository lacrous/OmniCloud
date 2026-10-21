import { beforeEach, describe, expect, it } from "vitest";
import { TrashService } from "../src/services/trash-service";
import { FileService } from "../src/services/file-service";
import { FolderService } from "../src/services/folder-service";
import { ActivityService } from "../src/services/activity-service";
import { StorageEngine } from "../src/storage/engine";
import { FakeStorageProvider, createInMemoryRepos, makeUser, type InMemoryRepos } from "./fakes";

let repos: InMemoryRepos;
let provider: FakeStorageProvider;
let files: FileService;
let folders: FolderService;
let trash: TrashService;
let user: ReturnType<typeof makeUser>;

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  repos = createInMemoryRepos();
  provider = new FakeStorageProvider();
  const engine = new StorageEngine(provider, { attempts: 1, baseDelayMs: 0 });
  const engineFor = async () => engine;
  files = new FileService(
    repos.files,
    repos.folders,
    engineFor,
    new ActivityService(repos.activity),
  );
  folders = new FolderService(
    repos.folders,
    repos.files,
    engineFor,
    new ActivityService(repos.activity),
  );
  trash = new TrashService(repos.files, repos.folders, engineFor);
  user = makeUser();
});

/** Trashes a file and backdates it, so it looks like it has been in the trash. */
async function trashedFileAged(days: number, name = "old.txt"): Promise<string> {
  const record = await files.upload(user.id, {
    folderId: null,
    name,
    data: Buffer.from(name),
  });
  await files.trash(user.id, record.id);
  const row = repos._files.find((f) => f.id === record.id)!;
  row.deletedAt = new Date(Date.now() - days * DAY_MS);
  return record.id;
}

describe("trash retention", () => {
  it("purges a file whose retention period has expired", async () => {
    const id = await trashedFileAged(40);
    expect(provider.objects.size).toBe(1);

    const result = await trash.purgeExpired(user.id, 30);

    expect(result.deletedFiles).toBe(1);
    expect(result.failedFiles).toBe(0);
    expect(repos._files.find((f) => f.id === id)).toBeUndefined();
    // The channel message is gone too, not just the row.
    expect(provider.objects.size).toBe(0);
  });

  it("keeps a file that is still within its retention period", async () => {
    const id = await trashedFileAged(5);

    const result = await trash.purgeExpired(user.id, 30);

    expect(result.deletedFiles).toBe(0);
    expect(result.skippedFiles).toBe(1);
    expect(repos._files.find((f) => f.id === id)).toBeDefined();
    expect(provider.objects.size).toBe(1);
  });

  it("does nothing when retention is disabled", async () => {
    const id = await trashedFileAged(400);

    const result = await trash.purgeExpired(user.id, 0);

    expect(result.deletedFiles).toBe(0);
    expect(repos._files.find((f) => f.id === id)).toBeDefined();
    expect(provider.objects.size).toBe(1);
  });

  it("removes every version's object, not only the current one", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: "v.txt",
      data: Buffer.from("one"),
    });
    await files.upload(user.id, {
      folderId: null,
      name: "v.txt",
      data: Buffer.from("two"),
      replaceFileId: record.id,
    });
    await files.trash(user.id, record.id);
    repos._files.find((f) => f.id === record.id)!.deletedAt = new Date(Date.now() - 40 * DAY_MS);
    expect(provider.objects.size).toBe(2);

    const result = await trash.purgeExpired(user.id, 30);

    expect(result.deletedFiles).toBe(1);
    expect(provider.objects.size).toBe(0);
    expect(repos._versions).toHaveLength(0);
  });

  it("purges a trashed folder once its contents are gone", async () => {
    const folder = await folders.create(user.id, { name: "old-folder", parentId: null });
    const file = await files.upload(user.id, {
      folderId: folder.id,
      name: "inside.txt",
      data: Buffer.from("inside"),
    });
    await folders.trash(user.id, folder.id);
    // Backdate the whole subtree, as a real trash would.
    const stamp = new Date(Date.now() - 40 * DAY_MS);
    for (const row of repos._files) row.deletedAt = stamp;
    for (const row of repos._folders) row.deletedAt = stamp;

    const result = await trash.purgeExpired(user.id, 30);

    expect(result.deletedFiles).toBe(1);
    expect(result.deletedFolders).toBe(1);
    expect(repos._folders.find((f) => f.id === folder.id)).toBeUndefined();
    expect(repos._files.find((f) => f.id === file.id)).toBeUndefined();
  });

  it("keeps a folder whose contents are still within the retention period", async () => {
    const folder = await folders.create(user.id, { name: "mixed-folder", parentId: null });
    await files.upload(user.id, {
      folderId: folder.id,
      name: "recent.txt",
      data: Buffer.from("recent"),
    });
    await folders.trash(user.id, folder.id);
    // The folder is old, but the file inside was trashed more recently.
    const old = new Date(Date.now() - 40 * DAY_MS);
    const recent = new Date(Date.now() - 2 * DAY_MS);
    for (const row of repos._folders) row.deletedAt = old;
    for (const row of repos._files) row.deletedAt = recent;

    const result = await trash.purgeExpired(user.id, 30);

    expect(result.deletedFiles).toBe(0);
    expect(result.deletedFolders).toBe(0);
    expect(repos._folders.find((f) => f.id === folder.id)).toBeDefined();
  });

  it("leaves the row in place when the object cannot be removed", async () => {
    const id = await trashedFileAged(40);
    provider.failAllDeletes = true;

    const result = await trash.purgeExpired(user.id, 30);

    expect(result.deletedFiles).toBe(0);
    expect(result.failedFiles).toBe(1);
    expect(repos._files.find((f) => f.id === id)).toBeDefined();
  });

  it("does not touch another user's trash", async () => {
    const stranger = makeUser();
    const record = await files.upload(stranger.id, {
      folderId: null,
      name: "theirs.txt",
      data: Buffer.from("theirs"),
    });
    await files.trash(stranger.id, record.id);
    repos._files.find((f) => f.id === record.id)!.deletedAt = new Date(Date.now() - 40 * DAY_MS);

    const result = await trash.purgeExpired(user.id, 30);

    expect(result.deletedFiles).toBe(0);
    expect(repos._files.find((f) => f.id === record.id)).toBeDefined();
  });
});
