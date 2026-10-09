import { beforeEach, describe, expect, it } from "vitest";
import { ActivityService } from "../src/services/activity-service";
import { FileService } from "../src/services/file-service";
import { ReconciliationService } from "../src/services/reconciliation-service";
import { StorageEngine } from "../src/storage/engine";
import { FakeStorageProvider, createInMemoryRepos, makeUser, type InMemoryRepos } from "./fakes";

let repos: InMemoryRepos;
let provider: FakeStorageProvider;
let files: FileService;
let reconcile: ReconciliationService;
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
  reconcile = new ReconciliationService(repos, async () => engine);
  user = makeUser();
});

describe("reconciliation service", () => {
  it("reports a healthy account as having nothing to review", async () => {
    await files.upload(user.id, { folderId: null, name: "a.txt", data: Buffer.from("a") });
    const report = await reconcile.run(user.id);
    expect(report.unknown).toEqual([]);
    expect(report.dangling).toEqual([]);
  });

  it("finds a stored object that no record references", async () => {
    await files.upload(user.id, { folderId: null, name: "a.txt", data: Buffer.from("a") });
    const orphan = await provider.put({
      name: "leaked.bin",
      mimeType: "x",
      data: Buffer.from("leak"),
    });

    const report = await reconcile.run(user.id);
    expect(report.unknown.map((u) => u.messageId)).toEqual([Number(orphan.messageId)]);
  });

  it("never deletes an unknown object: it is still in the channel afterwards", async () => {
    const orphan = await provider.put({
      name: "leaked.bin",
      mimeType: "x",
      data: Buffer.from("leak"),
    });
    await reconcile.run(user.id);
    expect(provider.objects.has(orphan.messageId)).toBe(true);
  });

  it("finds a record whose Telegram object is gone", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: "gone.txt",
      data: Buffer.from("g"),
    });
    provider.objects.delete(String(record.telegramMessageId));
    const report = await reconcile.run(user.id);
    expect(report.dangling.map((d) => d.messageId)).toContain(record.telegramMessageId);
  });

  it("is read-only: running it changes no records and no objects", async () => {
    await files.upload(user.id, { folderId: null, name: "a.txt", data: Buffer.from("a") });
    await provider.put({ name: "leaked.bin", mimeType: "x", data: Buffer.from("leak") });
    const objectsBefore = provider.objects.size;
    const filesBefore = repos._files.length;

    await reconcile.run(user.id);

    expect(provider.objects.size).toBe(objectsBefore);
    expect(repos._files.length).toBe(filesBefore);
  });

  it("scans only the requesting user's channel: another account's objects are never listed", async () => {
    // Production gives each user their own channel and engine. Model that here
    // with a separate provider for the other account.
    const other = makeUser("500");
    const otherProvider = new FakeStorageProvider();
    const otherEngine = new StorageEngine(otherProvider, { attempts: 1, baseDelayMs: 0 });
    const otherFiles = new FileService(
      repos.files,
      repos.folders,
      async () => otherEngine,
      new ActivityService(repos.activity),
    );
    await otherFiles.upload(other.id, { folderId: null, name: "o.txt", data: Buffer.from("o") });

    const scoped = new ReconciliationService(repos, async (userId) =>
      userId === other.id
        ? otherEngine
        : new StorageEngine(provider, { attempts: 1, baseDelayMs: 0 }),
    );
    const report = await scoped.run(user.id);

    expect(report.scannedMessages).toBe(0);
    expect(report.unknown).toEqual([]);
  });
});
