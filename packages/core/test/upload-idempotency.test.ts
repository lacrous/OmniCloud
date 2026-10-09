import { beforeEach, describe, expect, it } from "vitest";
import { ActivityService } from "../src/services/activity-service";
import { FileService } from "../src/services/file-service";
import { StorageEngine } from "../src/storage/engine";
import { FakeStorageProvider, createInMemoryRepos, makeUser, type InMemoryRepos } from "./fakes";

let repos: InMemoryRepos;
let provider: FakeStorageProvider;
let files: FileService;
let user: ReturnType<typeof makeUser>;
const OP = "op_retry_0001";

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

const upload = (operationId?: string) =>
  files.upload(user.id, {
    folderId: null,
    name: "a.txt",
    data: Buffer.from("payload"),
    operationId,
  });

describe("upload idempotency", () => {
  it("a retry with the same operation id returns the original file, not a second copy", async () => {
    const first = await upload(OP);
    const second = await upload(OP);

    expect(second.id).toBe(first.id);
    expect(repos._files).toHaveLength(1);
    expect(provider.objects.size).toBe(1);
  });

  it("different operation ids create different files", async () => {
    await upload("op_aaaa_1111");
    await upload("op_bbbb_2222");
    expect(repos._files).toHaveLength(2);
    expect(provider.objects.size).toBe(2);
  });

  it("an operation id is scoped to its user: another user cannot replay it", async () => {
    const other = makeUser("300");
    const mine = await upload(OP);
    const theirs = await files.upload(other.id, {
      folderId: null,
      name: "a.txt",
      data: Buffer.from("other"),
      operationId: OP,
    });
    expect(theirs.id).not.toBe(mine.id);
    expect(theirs.userId).toBe(other.id);
  });

  it("recovers an operation whose Telegram write succeeded but whose metadata commit failed", async () => {
    // Simulate a crash after the Telegram write: the object exists and the
    // operation is UPLOADING with its message id recorded, but no file record.
    const objectMessage = await provider.put({
      name: "a.txt",
      mimeType: "text/plain",
      data: Buffer.from("payload"),
    });
    repos._uploadOperations.push({
      id: "uop-crash",
      userId: user.id,
      operationId: OP,
      status: "UPLOADING",
      telegramMessageId: Number(objectMessage.messageId),
      sha256: null,
      size: 7,
      requestFingerprint: null,
      fileId: null,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const recovered = await upload(OP);

    expect(recovered.name).toBe("a.txt");
    expect(repos._files).toHaveLength(1);
    expect(provider.objects.size).toBe(1);
    expect(repos._uploadOperations[0]!.status).toBe("COMPLETED");
  });

  it("a failed first attempt can be retried under the same id and then succeeds", async () => {
    provider.failAllPuts = true;
    await expect(upload(OP)).rejects.toThrow();
    provider.failAllPuts = false;

    const record = await upload(OP);
    expect(record.name).toBe("a.txt");
    expect(repos._files).toHaveLength(1);
  });
});
