import { describe, expect, it } from "vitest";
import { ActivityService } from "../src/services/activity-service";
import { FileService } from "../src/services/file-service";
import { FolderService } from "../src/services/folder-service";
import { StorageEngine } from "../src/storage/engine";
import { FakeStorageProvider, createInMemoryRepos, makeUser } from "./fakes";

function setup() {
  const repos = createInMemoryRepos();
  const engine = new StorageEngine(new FakeStorageProvider(), { attempts: 1, baseDelayMs: 0 });
  const engineFor = async () => engine;
  const activity = new ActivityService(repos.activity);
  return {
    repos,
    files: new FileService(repos.files, repos.folders, engineFor, activity),
    folders: new FolderService(repos.folders, repos.files, engineFor, activity),
  };
}

describe("authorization across users", () => {
  it("a restored folder is never attached under another user's folder", async () => {
    const { repos, folders } = setup();
    const alice = makeUser("1");
    const mallory = makeUser("2");
    const victim = await folders.create(alice.id, { name: "Alice", parentId: null });
    const mine = await folders.create(mallory.id, { name: "Mine", parentId: null });
    await folders.trash(mallory.id, mine.id);
    // A foreign parent id written into the row must not survive a restore.
    repos._folders.find((f) => f.id === mine.id)!.parentId = victim.id;

    await folders.restore(mallory.id, mine.id);

    expect(repos._folders.find((f) => f.id === mine.id)!.parentId).not.toBe(victim.id);
  });

  it("another user cannot read, rename, trash or download a file by id", async () => {
    const { files } = setup();
    const alice = makeUser("1");
    const mallory = makeUser("2");
    const record = await files.upload(alice.id, {
      folderId: null,
      name: "a.txt",
      data: Buffer.from("a"),
    });

    await expect(files.get(mallory.id, record.id)).rejects.toThrow(/not found/i);
    await expect(files.rename(mallory.id, record.id, "x.txt")).rejects.toThrow(/not found/i);
    await expect(files.trash(mallory.id, record.id)).rejects.toThrow(/not found/i);
    await expect(files.downloadStreamed(mallory.id, record.id)).rejects.toThrow(/not found/i);
  });

  it("another user cannot move a file into a folder they do not own", async () => {
    const { files, folders } = setup();
    const alice = makeUser("1");
    const mallory = makeUser("2");
    const aliceFolder = await folders.create(alice.id, { name: "Alice", parentId: null });
    const mine = await files.upload(mallory.id, {
      folderId: null,
      name: "m.txt",
      data: Buffer.from("m"),
    });

    await expect(files.move(mallory.id, mine.id, aliceFolder.id)).rejects.toThrow(/not found/i);
  });

  it("another user cannot restore a folder they do not own", async () => {
    const { folders } = setup();
    const alice = makeUser("1");
    const mallory = makeUser("2");
    const aliceFolder = await folders.create(alice.id, { name: "A", parentId: null });
    await folders.trash(alice.id, aliceFolder.id);

    await expect(folders.restore(mallory.id, aliceFolder.id)).rejects.toThrow(/not found/i);
  });
});
