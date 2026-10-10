import { beforeEach, describe, expect, it } from "vitest";
import { ActivityService } from "../src/services/activity-service";
import { FileService } from "../src/services/file-service";
import { ReconciliationService } from "../src/services/reconciliation-service";
import { StorageEngine } from "../src/storage/engine";
import { FakeStorageProvider, createInMemoryRepos, makeUser, type InMemoryRepos } from "./fakes";

let repos: InMemoryRepos;
let provider: FakeStorageProvider;
let reconcile: ReconciliationService;
let user: ReturnType<typeof makeUser>;

beforeEach(() => {
  repos = createInMemoryRepos();
  provider = new FakeStorageProvider();
  const engine = new StorageEngine(provider, { attempts: 1, baseDelayMs: 0 });
  const files = new FileService(
    repos.files,
    repos.folders,
    async () => engine,
    new ActivityService(repos.activity),
    repos.uploadOperations,
  );
  void files;
  reconcile = new ReconciliationService(repos, async () => engine);
  user = makeUser();
});

describe("an object whose upload outcome is unknown", () => {
  it("is not reported as an orphan, because Telegram may still be holding it for that upload", async () => {
    const stored = await provider.put({
      name: "maybe.bin",
      mimeType: "x",
      data: Buffer.from("maybe"),
    });
    const op = await repos.uploadOperations.create({
      userId: user.id,
      operationId: "unknown_recon_0001",
    });
    await repos.uploadOperations.claim(op.id, "PENDING", "UPLOADING");
    await repos.uploadOperations.update(op.id, { telegramMessageId: Number(stored.messageId) });
    await repos.uploadOperations.claim(op.id, "UPLOADING", "UNKNOWN");

    const report = await reconcile.run(user.id);

    expect(report.unknown.map((u) => u.messageId)).not.toContain(Number(stored.messageId));
  });
});
