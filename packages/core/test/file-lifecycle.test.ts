import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundError, ValidationError } from "../src/errors";
import { ActivityService } from "../src/services/activity-service";
import { FileService } from "../src/services/file-service";
import { FolderService } from "../src/services/folder-service";
import { StorageEngine } from "../src/storage/engine";
import { sha256Hex } from "../src/utils/hash";
import { FakeStorageProvider, createInMemoryRepos, makeUser, type InMemoryRepos } from "./fakes";

let repos: InMemoryRepos;
let provider: FakeStorageProvider;
let files: FileService;
let folders: FolderService;
let user: ReturnType<typeof makeUser>;

function engineFor() {
  return async () => new StorageEngine(provider);
}

beforeEach(() => {
  repos = createInMemoryRepos();
  provider = new FakeStorageProvider();
  const activity = new ActivityService(repos.activity);
  files = new FileService(repos.files, repos.folders, engineFor(), activity);
  folders = new FolderService(repos.folders, repos.files, engineFor(), activity);
  user = makeUser("100");
  repos._users.push(user);
});

describe("file upload", () => {
  it("persists metadata only after the provider succeeds", async () => {
    provider.failAllPuts = true;
    await expect(
      files.upload(user.id, { folderId: null, name: "test.pdf", data: Buffer.from("x") }),
    ).rejects.toThrow();
    expect(repos._files).toHaveLength(0);
    expect(provider.objects.size).toBe(0);
  });

  it("derives MIME type server-side and stores the checksum + version 1", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: "report.pdf",
      data: Buffer.from("hello"),
    });

    expect(record.mimeType).toBe("application/pdf");
    expect(record.sha256).toBe(sha256Hex(Buffer.from("hello")));
    expect(record.size).toBe(5);
    expect(record.versionCount).toBe(1);
    expect(record.currentVersionId).not.toBeNull();
    expect(repos._versions.filter((v) => v.fileId === record.id)).toHaveLength(1);
  });

  it("records an upload activity event", async () => {
    await files.upload(user.id, { folderId: null, name: "a.txt", data: Buffer.from("a") });
    expect(repos._activity.some((e) => e.action === "upload")).toBe(true);
  });

  it("rejects names that sanitize to nothing", async () => {
    await expect(
      files.upload(user.id, { folderId: null, name: "..", data: Buffer.from("x") }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("file replacement (versioning)", () => {
  it("appends a version and repoints the current version", async () => {
    const created = await files.upload(user.id, {
      folderId: null,
      name: "doc.txt",
      data: Buffer.from("v1"),
    });
    // Snapshot: in-memory repos return live references, so read the value now.
    const firstVersionId = created.currentVersionId;

    const replaced = await files.upload(user.id, {
      folderId: null,
      name: "doc.txt",
      data: Buffer.from("v2-longer"),
      replaceFileId: created.id,
    });

    expect(replaced.id).toBe(created.id);
    expect(replaced.versionCount).toBe(2);
    expect(replaced.size).toBe(9);
    expect(replaced.currentVersionId).not.toBe(firstVersionId);

    const versions = await files.listVersions(user.id, created.id);
    expect(versions).toHaveLength(2);
    expect(versions[0]!.versionNumber).toBe(2);
    expect(versions[0]!.size).toBe(9);
  });
});

describe("file lifecycle: trash / restore / permanent delete", () => {
  it("soft-deletes without touching the remote object, then restores", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: "a.txt",
      data: Buffer.from("a"),
    });

    const trashed = await files.trash(user.id, record.id);
    expect(trashed.deletedAt).not.toBeNull();
    expect(provider.objects.size).toBe(1); // remote object preserved

    // Trashed files are hidden from active reads.
    await expect(files.getActive(user.id, record.id)).rejects.toThrow(NotFoundError);

    const restored = await files.restore(user.id, record.id);
    expect(restored.deletedAt).toBeNull();
    expect((await files.getActive(user.id, record.id)).id).toBe(record.id);
  });

  it("removes the remote object before metadata on permanent delete", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: "a.txt",
      data: Buffer.from("a"),
    });
    const messageId = [...provider.objects.keys()][0]!;

    await files.trash(user.id, record.id);
    await files.deletePermanently(user.id, record.id);

    expect(provider.objects.has(messageId)).toBe(false);
    expect(repos._files).toHaveLength(0);
    expect(repos._versions.filter((v) => v.fileId === record.id)).toHaveLength(0);
  });

  it("keeps metadata when the remote delete fails (so the user can retry)", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: "a.txt",
      data: Buffer.from("a"),
    });
    await files.trash(user.id, record.id);

    provider.failAllDeletes = true;
    await expect(files.deletePermanently(user.id, record.id)).rejects.toThrow();

    // Metadata survives so the operation can be retried.
    expect(repos._files).toHaveLength(1);
  });

  it("restores a file to root when its original folder is gone", async () => {
    const folder = await folders.create(user.id, { name: "Docs", parentId: null });
    const record = await files.upload(user.id, {
      folderId: folder.id,
      name: "a.txt",
      data: Buffer.from("a"),
    });
    await files.trash(user.id, record.id);

    // Folder is permanently removed while the file sits in the Trash.
    await repos.folders.deleteMany([folder.id]);

    const restored = await files.restore(user.id, record.id);
    expect(restored.folderId).toBeNull();
    expect(restored.deletedAt).toBeNull();
  });
});

describe("file star", () => {
  it("stars and unstars, recording activity", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: "a.txt",
      data: Buffer.from("a"),
    });

    expect((await files.setStarred(user.id, record.id, true)).starred).toBe(true);
    expect((await files.setStarred(user.id, record.id, false)).starred).toBe(false);
    expect(repos._activity.some((e) => e.action === "star")).toBe(true);
    expect(repos._activity.some((e) => e.action === "unstar")).toBe(true);
  });
});

describe("file batch operations", () => {
  it("applies an operation to many files and collects failures", async () => {
    const a = await files.upload(user.id, {
      folderId: null,
      name: "a.txt",
      data: Buffer.from("a"),
    });
    const b = await files.upload(user.id, {
      folderId: null,
      name: "b.txt",
      data: Buffer.from("b"),
    });

    const result = await files.batch(user.id, [a.id, b.id, "missing-id"], "trash");
    expect(result.requested).toBe(3);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    expect(repos._files.every((f) => f.deletedAt !== null)).toBe(true);
  });

  it("rejects an empty selection", async () => {
    await expect(files.batch(user.id, [], "trash")).rejects.toThrow(ValidationError);
  });
});

describe("ownership isolation", () => {
  it("hides other users' files", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: "secret.txt",
      data: Buffer.from("s"),
    });
    const stranger = makeUser("999");
    repos._users.push(stranger);

    await expect(files.get(stranger.id, record.id)).rejects.toThrow(NotFoundError);
    await expect(files.download(stranger.id, record.id)).rejects.toThrow(NotFoundError);
    await expect(files.batch(stranger.id, [record.id], "trash")).resolves.toMatchObject({
      succeeded: 0,
      failed: 1,
    });
  });
});

describe("download with integrity verification", () => {
  it("verifies the checksum of the returned bytes", async () => {
    const payload = Buffer.from("quick brown fox");
    const record = await files.upload(user.id, { folderId: null, name: "a.txt", data: payload });

    const result = await files.download(user.id, record.id);
    expect(result.data.equals(payload)).toBe(true);
    expect(result.integrityVerified).toBe(true);
  });

  it("flags tampered remote data", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: "a.txt",
      data: Buffer.from("a"),
    });
    const messageId = [...provider.objects.keys()][0]!;
    provider.objects.set(messageId, {
      name: "a.txt",
      mimeType: "text/plain",
      data: Buffer.from("tampered"),
    });

    expect((await files.download(user.id, record.id)).integrityVerified).toBe(false);
  });
});
