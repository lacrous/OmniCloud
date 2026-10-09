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
  const engine = new StorageEngine(provider, { attempts: 3, baseDelayMs: 0 });
  files = new FileService(
    repos.files,
    repos.folders,
    async () => engine,
    new ActivityService(repos.activity),
    repos.uploadOperations,
  );
  user = makeUser();
});

/** The consistency invariant every failure must leave intact. */
function assertConsistent(): void {
  const referenced = new Set<string>();
  for (const file of repos._files) referenced.add(String(file.telegramMessageId));
  for (const version of repos._versions) referenced.add(String(version.telegramMessageId));
  for (const op of repos._uploadOperations) {
    if (op.status === "UPLOADING" && op.telegramMessageId !== null)
      referenced.add(String(op.telegramMessageId));
  }
  for (const key of provider.objects.keys()) {
    expect(referenced.has(key), `object ${key} has no record`).toBe(true);
  }
  for (const id of referenced) {
    if (
      repos._uploadOperations.some(
        (o) => String(o.telegramMessageId) === id && o.status !== "COMPLETED",
      )
    )
      continue;
    expect(provider.objects.has(id), `record points at missing object ${id}`).toBe(true);
  }
}

describe("failure injection: uploads leave the system consistent", () => {
  it("a transient Telegram failure is retried and the result is consistent", async () => {
    provider.transientPutFailures = 2;
    await files.upload(user.id, { folderId: null, name: "a.txt", data: Buffer.from("a") });
    expect(repos._files).toHaveLength(1);
    assertConsistent();
  });

  it("a persistent Telegram failure creates no record and no object", async () => {
    provider.failAllPuts = true;
    await expect(
      files.upload(user.id, { folderId: null, name: "a.txt", data: Buffer.from("a") }),
    ).rejects.toThrow();
    expect(repos._files).toHaveLength(0);
    expect(provider.objects.size).toBe(0);
    assertConsistent();
  });

  it("a database failure after Telegram accepted the object removes that object", async () => {
    const realCreate = repos.files.create.bind(repos.files);
    repos.files.create = async () => {
      throw new Error("database connection lost");
    };
    await expect(
      files.upload(user.id, { folderId: null, name: "a.txt", data: Buffer.from("a") }),
    ).rejects.toThrow();
    repos.files.create = realCreate;
    expect(provider.objects.size).toBe(0);
    assertConsistent();
  });

  it("a retried upload after a crash commits exactly once", async () => {
    const op = "fault_op_0001";
    const realCreate = repos.files.create.bind(repos.files);
    repos.files.create = async () => {
      throw new Error("process crashed mid-commit");
    };
    await expect(
      files.upload(user.id, {
        folderId: null,
        name: "a.txt",
        data: Buffer.from("a"),
        operationId: op,
      }),
    ).rejects.toThrow();
    repos.files.create = realCreate;

    await files.upload(user.id, {
      folderId: null,
      name: "a.txt",
      data: Buffer.from("a"),
      operationId: op,
    });
    await files.upload(user.id, {
      folderId: null,
      name: "a.txt",
      data: Buffer.from("a"),
      operationId: op,
    });

    expect(repos._files).toHaveLength(1);
    expect(provider.objects.size).toBe(1);
    assertConsistent();
  });

  it("an operation stuck in UPLOADING with a stored object is recovered on retry", async () => {
    const stored = await provider.put({
      name: "a.txt",
      mimeType: "text/plain",
      data: Buffer.from("a"),
    });
    repos._uploadOperations.push({
      id: "uop-stuck",
      userId: user.id,
      operationId: "stuck_op_0001",
      status: "UPLOADING",
      telegramMessageId: Number(stored.messageId),
      sha256: null,
      size: 1,
      fileId: null,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await files.upload(user.id, {
      folderId: null,
      name: "a.txt",
      data: Buffer.from("a"),
      operationId: "stuck_op_0001",
    });
    expect(repos._files).toHaveLength(1);
    expect(provider.objects.size).toBe(1);
    assertConsistent();
  });

  it("many uploads with intermittent faults never leave an orphan", async () => {
    for (let i = 0; i < 20; i += 1) {
      provider.transientPutFailures = i % 3 === 0 ? 1 : 0;
      if (i % 5 === 0) provider.failAllPuts = true;
      try {
        await files.upload(user.id, {
          folderId: null,
          name: `f${i}.txt`,
          data: Buffer.from(`d${i}`),
        });
      } catch {
        // Expected for injected persistent failures.
      }
      provider.failAllPuts = false;
    }
    assertConsistent();
  });
});
