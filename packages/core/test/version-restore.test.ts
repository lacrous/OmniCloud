import { beforeEach, describe, expect, it } from "vitest";
import { ActivityService } from "../src/services/activity-service";
import { FileService } from "../src/services/file-service";
import { StorageEngine } from "../src/storage/engine";
import type { FileVersionRecord } from "../src/types";
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

/** A file with two versions: "one" then "two". */
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

/** Versions come back newest-first; these pick them out by number. */
function oldest(versions: FileVersionRecord[]): FileVersionRecord {
  return versions.reduce((a, b) => (a.versionNumber <= b.versionNumber ? a : b));
}

function newest(versions: FileVersionRecord[]): FileVersionRecord {
  return versions.reduce((a, b) => (a.versionNumber >= b.versionNumber ? a : b));
}

describe("restoring a version", () => {
  it("makes the older version current again", async () => {
    const id = await fileWithTwoVersions();
    const versions = await files.listVersions(user.id, id);
    expect(versions).toHaveLength(2);
    const first = oldest(versions);
    const second = newest(versions);

    const restored = await files.restoreVersion(user.id, id, first.id);

    expect(restored.currentVersionId).toBe(first.id);
    expect(restored.size).toBe(first.size);
    expect(restored.sha256).toBe(first.sha256);
    expect(restored.telegramMessageId).toBe(first.telegramMessageId);
    // The newer version still exists in history; restoring does not delete it.
    expect(await files.listVersions(user.id, id)).toHaveLength(2);
    expect(restored.versionCount).toBe(2);
    expect(second.versionNumber).toBeGreaterThan(first.versionNumber);
  });

  it("serves the restored content, not the newer one", async () => {
    const id = await fileWithTwoVersions();
    const versions = await files.listVersions(user.id, id);
    const first = oldest(versions);

    const engine = new StorageEngine(provider, { attempts: 1, baseDelayMs: 0 });
    const before = await engine.download({ messageId: String(first.telegramMessageId) });
    expect(before.toString()).toBe("one");

    await files.restoreVersion(user.id, id, first.id);

    const current = await files.get(user.id, id);
    const after = await engine.download({ messageId: String(current.telegramMessageId) });
    expect(after.toString()).toBe("one");
  });

  it("refuses to restore the version that is already current", async () => {
    const id = await fileWithTwoVersions();
    const current = await files.get(user.id, id);
    await expect(files.restoreVersion(user.id, id, current.currentVersionId!)).rejects.toThrow(
      /already the current/i,
    );
  });

  it("refuses a version that belongs to a different file", async () => {
    const id = await fileWithTwoVersions();
    const other = await files.upload(user.id, {
      folderId: null,
      name: "other.txt",
      data: Buffer.from("other"),
    });
    const otherVersions = await files.listVersions(user.id, other.id);

    await expect(files.restoreVersion(user.id, id, oldest(otherVersions).id)).rejects.toThrow(
      /not found/i,
    );
  });

  it("refuses a version owned by another user", async () => {
    const id = await fileWithTwoVersions();
    const versions = await files.listVersions(user.id, id);
    const stranger = makeUser();

    await expect(files.restoreVersion(stranger.id, id, oldest(versions).id)).rejects.toThrow(
      /not found/i,
    );
  });

  it("restores the encryption fields of the restored version", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: "enc.bin",
      data: Buffer.from("cipher-one"),
      encryption: {
        format: "OCE1",
        wrappedKey: "wrapped-one",
        metadataBlob: "meta-one",
        keyEpoch: 0,
      },
    });
    await files.upload(user.id, {
      folderId: null,
      name: "enc.bin",
      data: Buffer.from("cipher-two"),
      replaceFileId: record.id,
      encryption: {
        format: "OCE1",
        wrappedKey: "wrapped-two",
        metadataBlob: "meta-two",
        keyEpoch: 0,
      },
    });

    const versions = await files.listVersions(user.id, record.id);
    const first = oldest(versions);
    const restored = await files.restoreVersion(user.id, record.id, first.id);

    // The version keeps its own wrapped key and metadata blob: the OCE1
    // authentication binds the version id, so the file must carry the
    // encryption fields of the version it now points at.
    expect(restored.wrappedKey).toBe("wrapped-one");
    expect(restored.metadataBlob).toBe("meta-one");
    expect(restored.encryptionFormat).toBe("OCE1");
  });
});

describe("deleting a version", () => {
  it("removes that version's object and row and leaves the others", async () => {
    const id = await fileWithTwoVersions();
    const versions = await files.listVersions(user.id, id);
    const first = oldest(versions);
    const second = newest(versions);
    const objectsBefore = provider.objects.size;
    expect(objectsBefore).toBe(2);

    await files.deleteVersion(user.id, id, first.id);

    // The deleted version's remote object is gone; the other one remains.
    expect(provider.objects.size).toBe(1);
    expect(provider.objects.has(String(second.telegramMessageId))).toBe(true);
    expect(provider.objects.has(String(first.telegramMessageId))).toBe(false);

    const remaining = await files.listVersions(user.id, id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(second.id);
  });

  it("leaves the current version and its content untouched", async () => {
    const id = await fileWithTwoVersions();
    const versions = await files.listVersions(user.id, id);
    const first = oldest(versions);
    const second = newest(versions);

    await files.deleteVersion(user.id, id, first.id);

    const current = await files.get(user.id, id);
    expect(current.currentVersionId).toBe(second.id);
    expect(current.size).toBe(second.size);
    expect(current.versionCount).toBe(1);
  });

  it("refuses to delete the current version", async () => {
    const id = await fileWithTwoVersions();
    const current = await files.get(user.id, id);

    await expect(files.deleteVersion(user.id, id, current.currentVersionId!)).rejects.toThrow(
      /current version cannot be deleted/i,
    );
    // Nothing was removed.
    expect(provider.objects.size).toBe(2);
    expect(await files.listVersions(user.id, id)).toHaveLength(2);
  });

  it("refuses a version owned by another user", async () => {
    const id = await fileWithTwoVersions();
    const versions = await files.listVersions(user.id, id);
    const stranger = makeUser();

    await expect(files.deleteVersion(stranger.id, id, oldest(versions).id)).rejects.toThrow(
      /not found/i,
    );
    expect(provider.objects.size).toBe(2);
  });

  it("keeps the version row when the remote object cannot be removed", async () => {
    const id = await fileWithTwoVersions();
    const versions = await files.listVersions(user.id, id);
    const first = oldest(versions);
    provider.failAllDeletes = true;

    await expect(files.deleteVersion(user.id, id, first.id)).rejects.toThrow();
    // The row survives so reconciliation can find the orphaned object later.
    expect(await files.listVersions(user.id, id)).toHaveLength(2);
  });
});
