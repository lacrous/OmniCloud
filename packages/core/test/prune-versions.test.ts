import { beforeEach, describe, expect, it } from "vitest";
import { ActivityService } from "../src/services/activity-service";
import { FileService } from "../src/services/file-service";
import { StorageEngine } from "../src/storage/engine";
import { FakeStorageProvider, createInMemoryRepos, makeUser, type InMemoryRepos } from "./fakes";

let repos: InMemoryRepos;
let provider: FakeStorageProvider;
let files: FileService;
let user: ReturnType<typeof makeUser>;

beforeEach(() => {
  repos = createInMemoryRepos();
  provider = new FakeStorageProvider();
  provider.latencyMs = 0;
  const engine = new StorageEngine(provider, { attempts: 1, baseDelayMs: 0 });
  const engineFor = async () => engine;
  files = new FileService(
    repos.files,
    repos.folders,
    engineFor,
    new ActivityService(repos.activity),
    repos.uploadOperations,
  );
  user = makeUser();
});

/** Creates a file with `count` versions, the last one current. */
async function fileWithVersions(count: number): Promise<string> {
  const created = await files.upload(user.id, {
    folderId: null,
    name: "doc.txt",
    data: Buffer.from("v1"),
  });
  for (let i = 2; i <= count; i += 1) {
    await files.upload(user.id, {
      folderId: null,
      name: "doc.txt",
      data: Buffer.from(`v${i}`),
      replaceFileId: created.id,
    });
  }
  return created.id;
}

describe("pruneVersions", () => {
  it("keeps every version under the default KEEP_ALL policy", async () => {
    const id = await fileWithVersions(3);
    const removed = await files.pruneVersions(user.id, id, { kind: "KEEP_ALL" });
    expect(removed).toBe(0);
    expect(repos._files.find((f) => f.id === id)).toBeDefined();
    expect(repos._versions.filter((v) => v.fileId === id)).toHaveLength(3);
  });

  it("removes old versions and their Telegram objects, keeping the newest N", async () => {
    const id = await fileWithVersions(4);
    const objectsBefore = provider.objects.size;

    const removed = await files.pruneVersions(user.id, id, { kind: "KEEP_LATEST_N", count: 1 });

    expect(removed).toBe(2);
    expect(repos._versions.filter((v) => v.fileId === id)).toHaveLength(2);
    expect(provider.objects.size).toBe(objectsBefore - 2);
  });

  it("never removes the current version, even when N is zero", async () => {
    const id = await fileWithVersions(3);
    const current = repos._files.find((f) => f.id === id)!.currentVersionId;

    await files.pruneVersions(user.id, id, { kind: "KEEP_LATEST_N", count: 0 });

    const remaining = repos._versions.filter((v) => v.fileId === id);
    expect(remaining.map((v) => v.id)).toContain(current);
    expect(remaining).toHaveLength(1);
  });

  it("keeps a version's row when its Telegram object cannot be deleted", async () => {
    const id = await fileWithVersions(3);
    provider.failAllDeletes = true;

    await expect(
      files.pruneVersions(user.id, id, { kind: "KEEP_LATEST_N", count: 0 }),
    ).rejects.toThrow();

    expect(repos._versions.filter((v) => v.fileId === id)).toHaveLength(3);
  });

  it("only touches the file it was given", async () => {
    const mine = await fileWithVersions(3);
    const other = await fileWithVersions(3);

    await files.pruneVersions(user.id, mine, { kind: "KEEP_LATEST_N", count: 0 });

    expect(repos._versions.filter((v) => v.fileId === other)).toHaveLength(3);
  });
});
