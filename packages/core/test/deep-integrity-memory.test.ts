import { beforeEach, describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { ActivityService } from "../src/services/activity-service";
import { FileService } from "../src/services/file-service";
import { IntegrityService } from "../src/services/integrity-service";
import { StorageEngine } from "../src/storage/engine";
import { FakeStorageProvider, createInMemoryRepos, makeUser, type InMemoryRepos } from "./fakes";

const MB = 1024 * 1024;
let repos: InMemoryRepos;
let provider: FakeStorageProvider;
let integrity: IntegrityService;
let user: ReturnType<typeof makeUser>;

beforeEach(() => {
  repos = createInMemoryRepos();
  provider = new FakeStorageProvider();
  const engine = new StorageEngine(provider, { attempts: 1, baseDelayMs: 0 });
  const engineFor = async () => engine;
  const files = new FileService(
    repos.files,
    repos.folders,
    engineFor,
    new ActivityService(repos.activity),
  );
  integrity = new IntegrityService(repos.files, engineFor);
  user = makeUser();
  void files;
});

describe("deep integrity scan", () => {
  it("verifies a large object by streaming it, without buffering the whole file", async () => {
    const size = 64 * MB;
    const chunk = Buffer.alloc(512 * 1024, 7);
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256");
    for (let produced = 0; produced < size; produced += chunk.byteLength) hash.update(chunk);
    const sha256 = hash.digest("hex");

    const file = repos._files;
    void file;
    const record = {
      id: "big-1",
      userId: user.id,
      folderId: null,
      name: "big.bin",
      size,
      mimeType: "application/octet-stream",
      sha256,
      telegramMessageId: 9001,
      starred: false,
      deletedAt: null,
      trashBatchId: null,
      currentVersionId: null,
      versionCount: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    repos._files.push(record as never);
    provider.objects.set("9001", {
      name: "big.bin",
      mimeType: "application/octet-stream",
      data: Buffer.alloc(0),
    });
    provider.getStream = async () => {
      let produced = 0;
      return new Readable({
        read() {
          if (produced >= size) return this.push(null);
          produced += chunk.byteLength;
          this.push(chunk);
        },
      });
    };
    provider.stat = async () => ({
      messageId: "9001",
      name: "big.bin",
      size,
      mimeType: "application/octet-stream",
    });

    provider.get = async () => {
      throw new Error("deep scan must stream, not buffer the whole object");
    };

    const report = await integrity.check(user.id, { deep: true });
    expect(report.issues).toHaveLength(0);
    expect(report.healthy).toBe(1);
  });
});
