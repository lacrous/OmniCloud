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

describe("an operation left COMMITTING by a crash", () => {
  it("can be recovered by a retry instead of conflicting forever", async () => {
    // A crash between taking the commit claim and writing the file row.
    const op = await repos.uploadOperations.create({
      userId: user.id,
      operationId: "stuck_committing_1",
    });
    await repos.uploadOperations.claim(op.id, "PENDING", "UPLOADING");
    await repos.uploadOperations.update(op.id, {
      telegramMessageId: 4242,
      sha256: "a".repeat(64),
      size: 4,
    });
    await repos.uploadOperations.claim(op.id, "UPLOADING", "COMMITTING");

    const data = Buffer.from("data");
    const outcome = await files
      .upload(user.id, {
        folderId: null,
        name: "s.txt",
        data,
        operationId: "stuck_committing_1",
        replaceFileId: undefined,
      })
      .then(
        (r) => `ok:${r.name}`,
        (e: Error) => `err:${e.constructor.name}`,
      );

    const after = repos._uploadOperations.find((o) => o.operationId === "stuck_committing_1");
    const rows = await repos.files.listByUser(user.id);
    // It must not stay COMMITTING with no file and no way forward.
    expect(after?.status === "COMMITTING" && after.fileId === null).toBe(false);
    expect(rows.length).toBeLessThanOrEqual(1);
    expect(outcome).toMatch(/^ok:|^err:ConflictError$/);
  });
});
