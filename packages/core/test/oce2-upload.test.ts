import { beforeEach, describe, expect, it } from "vitest";
import { ActivityService } from "../src/services/activity-service";
import { FileService } from "../src/services/file-service";
import { StorageEngine } from "../src/storage/engine";
import { generateOpaqueName } from "@omnicloud/shared";
import { FakeStorageProvider, createInMemoryRepos, makeUser, type InMemoryRepos } from "./fakes";

let repos: InMemoryRepos;
let provider: FakeStorageProvider;
let files: FileService;
let user: ReturnType<typeof makeUser>;

const encryption = (format: "OCE1" | "OCE2") => ({
  format,
  wrappedKey: "A".repeat(96),
  metadataBlob: "B".repeat(88),
  keyEpoch: 0,
});

beforeEach(() => {
  repos = createInMemoryRepos();
  provider = new FakeStorageProvider();
  const engine = new StorageEngine(provider, { attempts: 1, baseDelayMs: 0 });
  files = new FileService(
    repos.files,
    repos.folders,
    async () => engine,
    new ActivityService(repos.activity),
  );
  user = makeUser();
});

describe("a file stored as OCE2", () => {
  it("is accepted when it is uploaded under an opaque name", async () => {
    const name = generateOpaqueName();
    const record = await files.upload(user.id, {
      folderId: null,
      name,
      data: Buffer.from("ciphertext"),
      encryption: encryption("OCE2"),
    });

    expect(record.name).toBe(name);
    expect(record.encryptionFormat).toBe("OCE2");
  });

  it("is refused when it is uploaded under a real name", async () => {
    // The whole point of OCE2 is that the server never sees the name, so a
    // client claiming the format while sending the real name would defeat it.
    await expect(
      files.upload(user.id, {
        folderId: null,
        name: "tax-return-2026.pdf",
        data: Buffer.from("ciphertext"),
        encryption: encryption("OCE2"),
      }),
    ).rejects.toThrow(/opaque name/i);
  });

  it("is refused on a replacement too", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: generateOpaqueName(),
      data: Buffer.from("ciphertext"),
      encryption: encryption("OCE2"),
    });

    await expect(
      files.upload(user.id, {
        folderId: null,
        name: "another-real-name.pdf",
        data: Buffer.from("more ciphertext"),
        replaceFileId: record.id,
        encryption: encryption("OCE2"),
      }),
    ).rejects.toThrow(/opaque name/i);
  });
});

describe("a file stored as OCE1", () => {
  it("still accepts a real name", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: "report.pdf",
      data: Buffer.from("ciphertext"),
      encryption: encryption("OCE1"),
    });

    expect(record.name).toBe("report.pdf");
    expect(record.encryptionFormat).toBe("OCE1");
  });

  it("is unaffected by the opaque-name rule", async () => {
    await expect(
      files.upload(user.id, {
        folderId: null,
        name: "not-opaque.txt",
        data: Buffer.from("ciphertext"),
        encryption: encryption("OCE1"),
      }),
    ).resolves.toBeDefined();
  });
});
