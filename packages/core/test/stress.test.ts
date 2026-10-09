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
let user: ReturnType<typeof makeUser>;

beforeEach(() => {
  repos = createInMemoryRepos();
  provider = new FakeStorageProvider();
  provider.latencyMs = 0;
  const engine = new StorageEngine(provider, { attempts: 2, baseDelayMs: 0 });
  const engineFor = async () => engine;
  const activity = new ActivityService(repos.activity);
  files = new FileService(repos.files, repos.folders, engineFor, activity, repos.uploadOperations);
  folders = new FolderService(repos.folders, repos.files, engineFor, activity);
  user = makeUser();
});

/** Walks every folder upward; any chain longer than the folder count is a cycle. */
function assertNoFolderCycle(): void {
  const parentOf = new Map(repos._folders.map((f) => [f.id, f.parentId]));
  for (const folder of repos._folders) {
    const seen = new Set<string>();
    let cursor: string | null = folder.id;
    while (cursor !== null) {
      expect(seen.has(cursor), `cycle through ${cursor}`).toBe(false);
      seen.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
  }
}

describe("stress: concurrent operations", () => {
  it("many concurrent uploads each produce exactly one file and one object", async () => {
    const count = 60;
    await Promise.all(
      Array.from({ length: count }, (_, i) =>
        files.upload(user.id, {
          folderId: null,
          name: `s${i}.txt`,
          data: Buffer.from(`payload-${i}`),
        }),
      ),
    );
    expect(repos._files).toHaveLength(count);
    expect(provider.objects.size).toBe(count);
  });

  it("concurrent retries of one idempotent upload store it once", async () => {
    const op = "stress_op_0001";
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        files.upload(user.id, {
          folderId: null,
          name: "same.txt",
          data: Buffer.from("once"),
          operationId: op,
        }),
      ),
    );
    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(1);
    expect(repos._files).toHaveLength(1);
    expect(provider.objects.size).toBe(1);
  });

  it("concurrent random folder moves never create a cycle", async () => {
    const created = [];
    for (let i = 0; i < 12; i += 1) {
      created.push(await folders.create(user.id, { name: `F${i}`, parentId: null }));
    }
    const attempts: Promise<unknown>[] = [];
    for (let round = 0; round < 80; round += 1) {
      const a = created[(round * 7) % created.length]!;
      const b = created[(round * 13 + 5) % created.length]!;
      attempts.push(folders.move(user.id, a.id, b.id).catch(() => undefined));
    }
    await Promise.all(attempts);
    assertNoFolderCycle();
  });
});
