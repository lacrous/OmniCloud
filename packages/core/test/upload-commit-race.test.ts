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

describe("concurrent commits of one upload operation", () => {
  it("a second request arriving after the object is stored does not create a second file", async () => {
    const key = "race_key_0002";
    const data = Buffer.from("race content");

    // Hold the first request inside its commit, after the Telegram object exists
    // and before its File row is written, so the second request sees UPLOADING.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const originalCreate = repos.files.create.bind(repos.files);
    let firstPaused = false;
    repos.files.create = async (input) => {
      if (!firstPaused) {
        firstPaused = true;
        await gate;
      }
      return originalCreate(input);
    };

    const first = files.upload(user.id, {
      folderId: null,
      name: "race.txt",
      data,
      operationId: key,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = files
      .upload(user.id, { folderId: null, name: "race.txt", data, operationId: key })
      .then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    await first.catch(() => undefined);
    await second;

    expect(repos._files.filter((f) => f.userId === user.id)).toHaveLength(1);
  });
});

describe("replaying a completed upload", () => {
  it("a retry after success returns the original file and creates no second record", async () => {
    const key = "replay_key_0003";
    const data = Buffer.from("replay content");
    const first = await files.upload(user.id, {
      folderId: null,
      name: "r.txt",
      data,
      operationId: key,
    });
    const again = await files.upload(user.id, {
      folderId: null,
      name: "r.txt",
      data,
      operationId: key,
    });
    expect(again.id).toBe(first.id);
    expect(repos._files.filter((f) => f.userId === user.id)).toHaveLength(1);
    expect(provider.objects.size).toBe(1);
  });
});
