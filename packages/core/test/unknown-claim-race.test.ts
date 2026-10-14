import { beforeEach, describe, expect, it } from "vitest";
import { ActivityService } from "../src/services/activity-service";
import { FileService } from "../src/services/file-service";
import { StorageEngine } from "../src/storage/engine";
import { sha256Hex } from "../src/utils/hash";
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

async function unknownOperation(operationId: string, data: Buffer) {
  const sha = sha256Hex(data);
  const op = await repos.uploadOperations.create({ userId: user.id, operationId });
  await repos.uploadOperations.claim(op.id, "PENDING", "UPLOADING");
  await repos.uploadOperations.claim(op.id, "UPLOADING", "UNKNOWN");
  await repos.uploadOperations.update(op.id, { sha256: sha, size: data.byteLength });
  await provider.put({
    name: "race.txt",
    mimeType: "text/plain",
    data,
    caption: `${sha}:${operationId}`,
  });
}

describe("concurrent recovery of one UNKNOWN operation", () => {
  it("commits exactly one file when two requests race", async () => {
    const data = Buffer.from("race-body");
    await unknownOperation("raceop_0001", data);

    await Promise.allSettled([
      files.upload(user.id, { folderId: null, name: "race.txt", data, operationId: "raceop_0001" }),
      files.upload(user.id, { folderId: null, name: "race.txt", data, operationId: "raceop_0001" }),
    ]);

    expect(await repos.files.listByUser(user.id)).toHaveLength(1);
  });

  it("the request that loses the claim does not commit", async () => {
    const data = Buffer.from("loser-body");
    await unknownOperation("raceop_0002", data);
    const original = repos.uploadOperations.claim.bind(repos.uploadOperations);
    repos.uploadOperations.claim = async (id, from, to) => {
      if (from === "UNKNOWN" && to === "COMMITTING") return false;
      return original(id, from, to);
    };

    const outcome = await files
      .upload(user.id, { folderId: null, name: "race.txt", data, operationId: "raceop_0002" })
      .then(
        () => "committed",
        () => "rejected",
      );
    repos.uploadOperations.claim = original;

    expect(outcome).toBe("rejected");
    expect(await repos.files.listByUser(user.id)).toHaveLength(0);
  });
});
