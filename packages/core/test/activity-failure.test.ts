import { beforeEach, describe, expect, it } from "vitest";
import { ActivityService } from "../src/services/activity-service";
import type { ActivityRecorder } from "../src/services/activity-service";
import { FileService } from "../src/services/file-service";
import { StorageEngine } from "../src/storage/engine";
import { FakeStorageProvider, createInMemoryRepos, makeUser, type InMemoryRepos } from "./fakes";

let repos: InMemoryRepos;
let provider: FakeStorageProvider;
let user: ReturnType<typeof makeUser>;

beforeEach(() => {
  repos = createInMemoryRepos();
  provider = new FakeStorageProvider();
  user = makeUser();
});

describe("a failing activity store does not damage a committed upload", () => {
  it("keeps the file and its object when the activity store throws", async () => {
    // Production passes ActivityService, which must absorb a store failure.
    const recorder: ActivityRecorder = new ActivityService({
      record: async () => {
        throw new Error("activity store unavailable");
      },
      list: async () => ({ items: [], total: 0 }),
    } as never);
    const engine = new StorageEngine(provider, { attempts: 1, baseDelayMs: 0 });
    const service = new FileService(repos.files, repos.folders, async () => engine, recorder);

    const record = await service.upload(user.id, {
      folderId: null,
      name: "a.txt",
      data: Buffer.from("a"),
    });

    expect(record.name).toBe("a.txt");
    const rows = await repos.files.listByUser(user.id);
    expect(rows).toHaveLength(1);
    expect(provider.objects.has(String(rows[0]!.telegramMessageId))).toBe(true);
  });
});
