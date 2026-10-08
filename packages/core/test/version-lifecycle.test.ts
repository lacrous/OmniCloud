import { beforeEach, describe, expect, it } from "vitest";
import { ActivityService } from "../src/services/activity-service";
import { FileService } from "../src/services/file-service";
import { FolderService } from "../src/services/folder-service";
import { StorageEngine } from "../src/storage/engine";
import { FakeStorageProvider, createInMemoryRepos, makeUser, type InMemoryRepos } from "./fakes";

let repos: InMemoryRepos;
let provider: FakeStorageProvider;
let files: FileService;
let user: ReturnType<typeof makeUser>;

beforeEach(() => {
  repos = createInMemoryRepos();
  provider = new FakeStorageProvider();
  const activity = new ActivityService(repos.activity);
  const engine = new StorageEngine(provider, { attempts: 1, baseDelayMs: 0 });
  const engineFor = async () => engine;
  files = new FileService(repos.files, repos.folders, engineFor, activity);
  void FolderService;
  user = makeUser();
});

async function fileWithTwoVersions() {
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
  return record.id;
}

describe("version lifecycle", () => {
  it("removes every version's remote object on permanent delete", async () => {
    const id = await fileWithTwoVersions();
    expect(provider.objects.size).toBe(2);

    await files.trash(user.id, id);
    await files.deletePermanently(user.id, id);

    expect(provider.objects.size).toBe(0);
    expect(repos._files).toHaveLength(0);
    expect(repos._versions).toHaveLength(0);
  });

  it("does not drop an old version whose remote object survived a failed delete", async () => {
    const id = await fileWithTwoVersions();
    await files.trash(user.id, id);

    // The current object is removed first and succeeds; the next delete (the
    // old version's object) fails. Its metadata must survive, or the leftover
    // Telegram object is orphaned with nothing pointing at it.
    provider.failNextDelete = false;
    const versionsBefore = repos._versions.filter((v) => v.fileId === id).length;
    const oldMessage = String(
      repos._versions.find((v) => v.fileId === id && v.versionNumber === 1)!.telegramMessageId,
    );
    const originalDelete = provider.delete.bind(provider);
    provider.delete = async (ref) => {
      if (ref.messageId === oldMessage) throw new Error("simulated old-version delete failure");
      return originalDelete(ref);
    };

    await expect(files.deletePermanently(user.id, id)).rejects.toThrow(/Delete failed/);

    expect(provider.objects.has(oldMessage)).toBe(true);
    expect(repos._versions.some((v) => String(v.telegramMessageId) === oldMessage)).toBe(true);
    expect(repos._versions.filter((v) => v.fileId === id)).toHaveLength(versionsBefore);
    expect(repos._files).toHaveLength(1);
  });

  it("completes a retried permanent delete once the remote failure clears", async () => {
    const id = await fileWithTwoVersions();
    await files.trash(user.id, id);

    provider.failAllDeletes = true;
    await expect(files.deletePermanently(user.id, id)).rejects.toThrow();

    provider.failAllDeletes = false;
    await files.deletePermanently(user.id, id);

    expect(provider.objects.size).toBe(0);
    expect(repos._files).toHaveLength(0);
    expect(repos._versions).toHaveLength(0);
  });
});
