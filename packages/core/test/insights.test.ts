import { beforeEach, describe, expect, it } from "vitest";
import { FileService } from "../src/services/file-service";
import { FolderService } from "../src/services/folder-service";
import { StatsService } from "../src/services/stats-service";
import { RecentService } from "../src/services/recent-service";
import { ActivityService } from "../src/services/activity-service";
import { IntegrityService } from "../src/services/integrity-service";
import { StorageEngine } from "../src/storage/engine";
import { FakeStorageProvider, createInMemoryRepos, makeUser, type InMemoryRepos } from "./fakes";

let repos: InMemoryRepos;
let provider: FakeStorageProvider;
let files: FileService;
let folders: FolderService;
let stats: StatsService;
let recent: RecentService;
let activity: ActivityService;
let integrity: IntegrityService;
let user: ReturnType<typeof makeUser>;

beforeEach(() => {
  repos = createInMemoryRepos();
  provider = new FakeStorageProvider();
  const engineFor = async () => new StorageEngine(provider);
  activity = new ActivityService(repos.activity);
  files = new FileService(repos.files, repos.folders, engineFor, activity);
  folders = new FolderService(repos.folders, repos.files, engineFor, activity);
  stats = new StatsService(repos.files, repos.folders);
  recent = new RecentService(repos.activity, repos.files);
  integrity = new IntegrityService(repos.files, engineFor);
  user = makeUser("100");
  repos._users.push(user);
});

describe("storage statistics", () => {
  it("aggregates counts, sizes, trash and type breakdown", async () => {
    const folder = await folders.create(user.id, { name: "Docs", parentId: null });
    await files.upload(user.id, { folderId: folder.id, name: "a.pdf", data: Buffer.alloc(1000) });
    await files.upload(user.id, { folderId: null, name: "b.png", data: Buffer.alloc(2000) });
    const trashed = await files.upload(user.id, {
      folderId: null,
      name: "c.zip",
      data: Buffer.alloc(500),
    });
    await files.trash(user.id, trashed.id);
    await files.setStarred(user.id, (await repos.files.listByFolder(user.id, null))[0]!.id, true);

    const result = await stats.stats(user.id);

    expect(result.fileCount).toBe(2);
    expect(result.folderCount).toBe(1);
    expect(result.totalBytes).toBe(3000);
    expect(result.trashFileCount).toBe(1);
    expect(result.trashBytes).toBe(500);
    expect(result.starredCount).toBe(1);
    expect(result.quotaBytes).toBeNull();

    const pdf = result.byType.find((t) => t.category === "pdf");
    expect(pdf).toMatchObject({ bytes: 1000, count: 1 });
    expect(result.byType[0]!.bytes).toBeGreaterThanOrEqual(result.byType.at(-1)!.bytes);
  });

  it("returns the largest files first", async () => {
    await files.upload(user.id, { folderId: null, name: "small.txt", data: Buffer.alloc(10) });
    await files.upload(user.id, { folderId: null, name: "big.txt", data: Buffer.alloc(5000) });
    await files.upload(user.id, { folderId: null, name: "mid.txt", data: Buffer.alloc(1000) });

    const result = await stats.stats(user.id);
    expect(result.largestFiles.map((f) => f.name)).toEqual(["big.txt", "mid.txt", "small.txt"]);
  });

  it("carries the quota through when configured", async () => {
    const result = await stats.stats(user.id, 1024 ** 3);
    expect(result.quotaBytes).toBe(1024 ** 3);
  });
});

describe("activity log", () => {
  it("records events and lists them newest first", async () => {
    await files.upload(user.id, { folderId: null, name: "a.txt", data: Buffer.from("a") });
    await folders.create(user.id, { name: "Folder", parentId: null });

    const page = await activity.list(user.id, { page: 1, limit: 10 });
    expect(page.total).toBe(2);
    expect(page.items.map((e) => e.action)).toContain("upload");
    expect(page.items.map((e) => e.action)).toContain("create_folder");
  });

  it("never throws when the repository fails (logging is best-effort)", async () => {
    const broken = new ActivityService({
      ...repos.activity,
      record: async () => {
        throw new Error("db down");
      },
    });
    await expect(
      broken.record({
        userId: user.id,
        action: "upload",
        resourceType: "file",
        resourceId: "x",
      }),
    ).resolves.toBeUndefined();
  });

  it("strips credential-shaped metadata keys", async () => {
    await activity.record({
      userId: user.id,
      action: "upload",
      resourceType: "file",
      resourceId: "f1",
      metadata: { size: 10, sessionToken: "secret", password: "hunter2", apiHash: "abc" },
    });

    const event = repos._activity[0]!;
    expect(event.metadata).toEqual({ size: 10 });
  });

  it("prunes events older than the retention window", async () => {
    repos._activity.push({
      id: "old",
      userId: user.id,
      action: "upload",
      resourceType: "file",
      resourceId: "f",
      resourceName: null,
      metadata: null,
      createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
    });

    const removed = await activity.prune();
    expect(removed).toBe(1);
  });
});

describe("recent view", () => {
  it("lists recently touched active files, newest first, excluding trashed", async () => {
    const first = await files.upload(user.id, {
      folderId: null,
      name: "first.txt",
      data: Buffer.from("1"),
    });
    const second = await files.upload(user.id, {
      folderId: null,
      name: "second.txt",
      data: Buffer.from("2"),
    });

    await files.download(user.id, first.id); // bumps first to most recent
    await files.trash(user.id, second.id);

    const page = await recent.list(user.id, { page: 1, limit: 10 });
    expect(page.items.map((i) => i.file.name)).toEqual(["first.txt"]);
    expect(page.items[0]!.lastAction).toBe("download");
  });

  it("deduplicates repeated actions on the same file", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: "dup.txt",
      data: Buffer.from("d"),
    });
    await files.download(user.id, record.id);
    await files.download(user.id, record.id);

    const page = await recent.list(user.id, { page: 1, limit: 10 });
    expect(page.items.filter((i) => i.file.id === record.id)).toHaveLength(1);
  });
});

describe("integrity checks", () => {
  it("reports a healthy store", async () => {
    await files.upload(user.id, { folderId: null, name: "a.txt", data: Buffer.from("a") });
    await files.upload(user.id, { folderId: null, name: "b.txt", data: Buffer.from("bb") });

    const report = await integrity.check(user.id);
    expect(report.filesChecked).toBe(2);
    expect(report.healthy).toBe(2);
    expect(report.missing).toBe(0);
    expect(report.issues).toHaveLength(0);
  });

  it("detects a missing Telegram object", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: "gone.txt",
      data: Buffer.from("g"),
    });
    provider.objects.delete(String(record.telegramMessageId));

    const report = await integrity.check(user.id);
    expect(report.missing).toBe(1);
    expect(report.issues[0]).toMatchObject({ fileId: record.id, kind: "missing" });
  });

  it("detects a size mismatch", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: "size.txt",
      data: Buffer.from("abc"),
    });
    provider.objects.set(String(record.telegramMessageId), {
      name: "size.txt",
      mimeType: "text/plain",
      data: Buffer.alloc(999),
    });

    const report = await integrity.check(user.id);
    expect(report.inconsistent).toBe(1);
    expect(report.issues[0]!.kind).toBe("size_mismatch");
  });

  it("deep mode detects a hash mismatch", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: "hash.txt",
      data: Buffer.from("abc"),
    });
    // Same size, different bytes.
    provider.objects.set(String(record.telegramMessageId), {
      name: "hash.txt",
      mimeType: "text/plain",
      data: Buffer.from("xyz"),
    });

    const shallow = await integrity.check(user.id);
    expect(shallow.inconsistent).toBe(0); // size matches, so shallow passes

    const deep = await integrity.check(user.id, { deep: true });
    expect(deep.inconsistent).toBe(1);
    expect(deep.issues[0]!.kind).toBe("hash_mismatch");
  });

  it("never modifies data", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: "a.txt",
      data: Buffer.from("a"),
    });
    provider.objects.delete(String(record.telegramMessageId));

    const before = repos._files.length;
    await integrity.check(user.id, { deep: true });
    expect(repos._files).toHaveLength(before);
  });
});
