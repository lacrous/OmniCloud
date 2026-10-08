import { beforeEach, describe, expect, it } from "vitest";
import { ActivityService } from "../src/services/activity-service";
import { FileService } from "../src/services/file-service";
import { StorageEngine } from "../src/storage/engine";
import { FakeStorageProvider, createInMemoryRepos, makeUser, type InMemoryRepos } from "./fakes";

let repos: InMemoryRepos;
let files: FileService;
let user: ReturnType<typeof makeUser>;

beforeEach(() => {
  repos = createInMemoryRepos();
  const engine = new StorageEngine(new FakeStorageProvider(), { attempts: 1, baseDelayMs: 0 });
  files = new FileService(
    repos.files,
    repos.folders,
    async () => engine,
    new ActivityService(repos.activity),
  );
  user = makeUser();
});

describe("batch reliability", () => {
  it("one bad item does not stop the rest of the batch", async () => {
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

    const result = await files.batch(user.id, [a.id, "missing-id", b.id], "trash");

    expect(result).toMatchObject({ requested: 3, succeeded: 2, failed: 1 });
    expect(result.errors.map((e) => e.id)).toEqual(["missing-id"]);
    expect((await repos.files.findById(a.id))!.deletedAt).not.toBeNull();
    expect((await repos.files.findById(b.id))!.deletedAt).not.toBeNull();
  });

  it("a repeated trash of the same batch is safe: nothing is lost or duplicated", async () => {
    const a = await files.upload(user.id, {
      folderId: null,
      name: "a.txt",
      data: Buffer.from("a"),
    });
    await files.batch(user.id, [a.id], "trash");
    const again = await files.batch(user.id, [a.id], "trash");

    expect(again.succeeded + again.failed).toBe(1);
    expect(repos._files).toHaveLength(1);
  });

  it("echoes the caller's operation id so a batch result can be correlated", async () => {
    const a = await files.upload(user.id, {
      folderId: null,
      name: "a.txt",
      data: Buffer.from("a"),
    });
    const result = await files.batch(user.id, [a.id], "star", { operationId: "batch_op_0001" });
    expect(result.operationId).toBe("batch_op_0001");
  });

  it("omits the operation id when none was given", async () => {
    const a = await files.upload(user.id, {
      folderId: null,
      name: "a.txt",
      data: Buffer.from("a"),
    });
    const result = await files.batch(user.id, [a.id], "star");
    expect(result.operationId).toBeUndefined();
  });

  it("rejects an empty batch rather than reporting a silent success", async () => {
    await expect(files.batch(user.id, [], "trash")).rejects.toThrow(/No items selected/);
  });
});
