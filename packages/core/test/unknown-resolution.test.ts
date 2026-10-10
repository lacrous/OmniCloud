import { beforeEach, describe, expect, it } from "vitest";
import { ActivityService } from "../src/services/activity-service";
import { FileService } from "../src/services/file-service";
import { StorageEngine } from "../src/storage/engine";
import { FakeStorageProvider, createInMemoryRepos, makeUser, type InMemoryRepos } from "./fakes";
import { TelegramConnectionError } from "../src/errors";
import { sha256Hex } from "../src/utils/hash";

let repos: InMemoryRepos;
let provider: FakeStorageProvider;
let files: FileService;
let user: ReturnType<typeof makeUser>;

const OP = "resolve_0001";
const CONTENT = Buffer.from("resolve me");

beforeEach(() => {
  repos = createInMemoryRepos();
  provider = new FakeStorageProvider();
  provider.latencyMs = 0;
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

/** Makes the first write land in Telegram but report a lost response. */
async function uploadWithLostResponse(): Promise<void> {
  const original = provider.put.bind(provider);
  provider.put = async (input, control) => {
    await original(input, control);
    throw new TelegramConnectionError("Telegram response was lost after the write");
  };
  await expect(
    files.upload(user.id, { folderId: null, name: "r.txt", data: CONTENT, operationId: OP }),
  ).rejects.toThrow();
  provider.put = original;
}

function operation() {
  return repos._uploadOperations.find((o) => o.operationId === OP);
}

function retry() {
  return files.upload(user.id, {
    folderId: null,
    name: "r.txt",
    data: CONTENT,
    operationId: OP,
  });
}

describe("resolving an UNKNOWN upload", () => {
  it("adopts the single stored object without writing a second one", async () => {
    await uploadWithLostResponse();
    expect(operation()?.status).toBe("UNKNOWN");
    const writesBefore = provider.putCalls;

    const record = await retry();

    expect(provider.putCalls).toBe(writesBefore);
    expect(operation()).toMatchObject({ status: "COMPLETED", fileId: record.id });
    expect(record.telegramMessageId).toBe(Number(operation()!.telegramMessageId));
  });

  it("re-sends when the search finds nothing, because nothing was stored", async () => {
    await uploadWithLostResponse();
    provider.objects.clear();
    const writesBefore = provider.putCalls;

    const record = await retry();

    expect(provider.putCalls).toBe(writesBefore + 1);
    expect(operation()).toMatchObject({ status: "COMPLETED", fileId: record.id });
  });

  it("stays UNKNOWN and writes nothing when more than one object matches", async () => {
    await uploadWithLostResponse();
    const caption = `${sha256Hex(CONTENT)}:${OP}`;
    provider.objects.set("extra-1", {
      name: "r.txt",
      mimeType: "text/plain",
      data: CONTENT,
      caption,
    });
    provider.objects.set("extra-2", {
      name: "r.txt",
      mimeType: "text/plain",
      data: CONTENT,
      caption,
    });
    const writesBefore = provider.putCalls;

    await expect(retry()).rejects.toThrow(/more than one/);

    expect(provider.putCalls).toBe(writesBefore);
    expect(operation()?.status).toBe("UNKNOWN");
  });

  it("does not re-send an UNKNOWN upload recorded before the content hash was stored", async () => {
    const op = await repos.uploadOperations.create({ userId: user.id, operationId: OP });
    await repos.uploadOperations.claim(op.id, "PENDING", "UPLOADING");
    await repos.uploadOperations.claim(op.id, "UPLOADING", "UNKNOWN");
    const writesBefore = provider.putCalls;

    await expect(retry()).rejects.toThrow(/cannot be checked automatically/);

    expect(provider.putCalls).toBe(writesBefore);
    expect(operation()?.status).toBe("UNKNOWN");
  });

  it("stays UNKNOWN when the search itself fails", async () => {
    await uploadWithLostResponse();
    provider.findByCaption = async () => {
      throw new TelegramConnectionError("search unavailable");
    };
    const writesBefore = provider.putCalls;

    await expect(retry()).rejects.toThrow();

    expect(provider.putCalls).toBe(writesBefore);
    expect(operation()?.status).toBe("UNKNOWN");
  });
});

describe("an upload's caption identifies its own operation", () => {
  it("lets a retry adopt its own message even when identical bytes were uploaded earlier", async () => {
    const earlier = await files.upload(user.id, {
      folderId: null,
      name: "earlier.txt",
      data: CONTENT,
      operationId: "earlier_0009",
    });
    expect(earlier.id).toBeDefined();

    await uploadWithLostResponse();
    const writesBefore = provider.putCalls;

    const record = await retry();

    expect(provider.putCalls).toBe(writesBefore);
    expect(operation()).toMatchObject({ status: "COMPLETED", fileId: record.id });
  });
});
