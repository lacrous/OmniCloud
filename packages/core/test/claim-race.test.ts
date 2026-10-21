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

  it("does not commit when another request takes the commit claim", async () => {
    const op = "claim_race_0002";
    await repos.uploadOperations.create({ userId: user.id, operationId: op });
    const realClaim = repos.uploadOperations.claim.bind(repos.uploadOperations);
    repos.uploadOperations.claim = async (id, from, to) => {
      if (to === "COMMITTING") {
        await realClaim(id, from, to);
        return false;
      }
      return realClaim(id, from, to);
    };

    await expect(
      files.upload(user.id, {
        folderId: null,
        name: "race.txt",
        data: Buffer.from("once"),
        operationId: op,
      }),
    ).rejects.toThrow(/lost its commit claim/);

    expect(provider.objects.size).toBe(0);
    expect(repos._files).toHaveLength(0);
    expect(repos._uploadOperations[0]?.status).toBe("COMMITTING");
  });
});
