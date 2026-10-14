import { beforeEach, describe, expect, it } from "vitest";
import { TrashService } from "../src/services/trash-service";
import { FileService } from "../src/services/file-service";
import { ActivityService } from "../src/services/activity-service";
import { StorageEngine } from "../src/storage/engine";
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

describe("emptying the trash", () => {
  it("removes old versions' Telegram objects, not only the current one", async () => {
    const first = await files.upload(user.id, {
      folderId: null,
      name: "v.txt",
      data: Buffer.from("one"),
    });
    await files.upload(user.id, {
      folderId: null,
      name: "v.txt",
      data: Buffer.from("two"),
      replaceFileId: first.id,
    });
    const versionsBefore = await repos.files.listVersions(first.id);
    expect(versionsBefore.length).toBe(2);
    const messages = new Set(versionsBefore.map((v) => String(v.telegramMessageId)));

    const trash = new TrashService(
      repos.files,
      repos.folders,
      async () => new StorageEngine(provider, { attempts: 1, baseDelayMs: 0 }),
    );
    await files.trash(user.id, first.id);
    await trash.empty(user.id);

    for (const messageId of messages) {
      expect(provider.objects.has(messageId)).toBe(false);
    }
  });
});
