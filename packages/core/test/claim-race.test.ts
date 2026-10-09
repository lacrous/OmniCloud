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

describe("claim on an existing PENDING operation", () => {
  it("two retries of one abandoned PENDING operation store the object once", async () => {
    const op = "claim_race_0001";
    // An earlier request created the operation and then died before uploading.
    await repos.uploadOperations.create({ userId: user.id, operationId: op });

    // Two retries now arrive together. Both read PENDING, so only the claim stops
    // both from uploading.
    const operations = repos.uploadOperations;
    const realClaim = operations.claim.bind(operations);
    // Both requests have already read PENDING. Hold each one just before its claim,
    // so they reach the compare-and-set together.
    operations.claim = async (id, from, to) => {
      await new Promise((resolve) => setImmediate(resolve));
      return realClaim(id, from, to);
    };

    const results = await Promise.all([
      files.upload(user.id, {
        folderId: null,
        name: "race.txt",
        data: Buffer.from("once"),
        operationId: op,
      }),
      files.upload(user.id, {
        folderId: null,
        name: "race.txt",
        data: Buffer.from("once"),
        operationId: op,
      }),
    ]);

    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(provider.objects.size).toBe(1);
    expect(repos._files).toHaveLength(1);
  });
});
