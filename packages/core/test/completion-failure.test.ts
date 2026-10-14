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
  const engine = new StorageEngine(provider, { attempts: 1, baseDelayMs: 0 });
  files = new FileService(
    repos.files,
    repos.folders,
    async () => engine,
    new ActivityService(repos.activity),
    repos.uploadOperations,
  );
  user = makeUser();
});

describe("a failed final status write after a committed upload", () => {
  it("a retry returns the committed file without writing a second copy", async () => {
    const original = repos.uploadOperations.update.bind(repos.uploadOperations);
    repos.uploadOperations.update = async (id, patch) => {
      if (patch.status === "COMPLETED") throw new Error("status write failed");
      return original(id, patch);
    };
    await files
      .upload(user.id, {
        folderId: null,
        name: "t.txt",
        data: Buffer.from("t"),
        operationId: "complete_fail_1",
      })
      .catch(() => undefined);
    repos.uploadOperations.update = original;

    const retried = await files.upload(user.id, {
      folderId: null,
      name: "t.txt",
      data: Buffer.from("t"),
      operationId: "complete_fail_1",
    });

    expect(await repos.files.listByUser(user.id)).toHaveLength(1);
    expect(provider.objects.size).toBe(1);
    expect(retried.name).toBe("t.txt");
  });

  it("the first request does not report failure for a file that was committed", async () => {
    const original = repos.uploadOperations.update.bind(repos.uploadOperations);
    repos.uploadOperations.update = async (id, patch) => {
      if (patch.status === "COMPLETED") throw new Error("status write failed");
      return original(id, patch);
    };
    const outcome = await files
      .upload(user.id, {
        folderId: null,
        name: "u.txt",
        data: Buffer.from("u"),
        operationId: "complete_fail_2",
      })
      .then(
        () => "ok",
        () => "error",
      );
    repos.uploadOperations.update = original;
    expect(await repos.files.listByUser(user.id)).toHaveLength(1);
    expect(outcome).toBe("ok");
  });
});

describe("a crash between recording the file and completing the operation", () => {
  it("a retry finds the recorded file and commits nothing new", async () => {
    const original = repos.uploadOperations.update.bind(repos.uploadOperations);
    repos.uploadOperations.update = async (id, patch) => {
      if (patch.status === "COMPLETED") throw new Error("crashed before COMPLETED");
      return original(id, patch);
    };
    await files
      .upload(user.id, {
        folderId: null,
        name: "k.txt",
        data: Buffer.from("k"),
        operationId: "crash_mid_1",
      })
      .catch(() => undefined);
    repos.uploadOperations.update = original;

    const before = (await repos.files.listByUser(user.id)).length;
    const retried = await files.upload(user.id, {
      folderId: null,
      name: "k.txt",
      data: Buffer.from("k"),
      operationId: "crash_mid_1",
    });
    expect((await repos.files.listByUser(user.id)).length).toBe(before);
    expect(retried.name).toBe("k.txt");
  });
});
