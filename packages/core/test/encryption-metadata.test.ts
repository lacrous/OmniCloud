import { beforeEach, describe, expect, it } from "vitest";
import { ActivityService } from "../src/services/activity-service";
import { FileService } from "../src/services/file-service";
import { StorageEngine } from "../src/storage/engine";
import { FakeStorageProvider, createInMemoryRepos, makeUser, type InMemoryRepos } from "./fakes";

let repos: InMemoryRepos;
let provider: FakeStorageProvider;
let files: FileService;
let user: ReturnType<typeof makeUser>;

const encryption = {
  format: "OCE1" as const,
  wrappedKey: "A".repeat(96),
  metadataBlob: "B".repeat(88),
  keyEpoch: 0,
};

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

describe("an encrypted upload persists its metadata", () => {
  it("writes the fields on both the File row and its first version row", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: "secret.bin",
      data: Buffer.from("ciphertext"),
      encryption,
    });

    expect(record.encryptionFormat).toBe("OCE1");
    expect(record.wrappedKey).toBe(encryption.wrappedKey);
    expect(record.metadataBlob).toBe(encryption.metadataBlob);
    expect(record.keyEpoch).toBe(0);

    const stored = repos._files.find((f) => f.id === record.id);
    expect(stored?.encryptionFormat).toBe("OCE1");
    expect(stored?.wrappedKey).toBe(encryption.wrappedKey);

    const versions = await repos.files.listVersions(record.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.encryptionFormat).toBe("OCE1");
    expect(versions[0]!.wrappedKey).toBe(encryption.wrappedKey);
    expect(versions[0]!.metadataBlob).toBe(encryption.metadataBlob);
    expect(versions[0]!.keyEpoch).toBe(0);
  });

  it("leaves the fields null for a plaintext upload", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: "plain.txt",
      data: Buffer.from("plaintext"),
    });

    expect(record.encryptionFormat ?? null).toBeNull();
    const versions = await repos.files.listVersions(record.id);
    expect(versions[0]!.encryptionFormat ?? null).toBeNull();
  });

  it("clears a file's encryption when it is replaced with plaintext", async () => {
    const first = await files.upload(user.id, {
      folderId: null,
      name: "secret.bin",
      data: Buffer.from("ciphertext"),
      encryption,
    });

    const replaced = await files.upload(user.id, {
      folderId: null,
      name: "secret.bin",
      data: Buffer.from("now plaintext"),
      replaceFileId: first.id,
    });

    expect(replaced.encryptionFormat ?? null).toBeNull();
    expect(replaced.wrappedKey ?? null).toBeNull();
    expect(replaced.metadataBlob ?? null).toBeNull();
    expect(replaced.keyEpoch ?? null).toBeNull();

    const versions = await repos.files.listVersions(first.id);
    expect(versions).toHaveLength(2);
    // The current version is plaintext; the old encrypted version keeps its fields.
    expect(versions[0]!.encryptionFormat ?? null).toBeNull();
    expect(versions[1]!.encryptionFormat).toBe("OCE1");
    expect(versions[1]!.wrappedKey).toBe(encryption.wrappedKey);
  });

  it("updates the file-level fields when replaced with new encryption", async () => {
    const first = await files.upload(user.id, {
      folderId: null,
      name: "secret.bin",
      data: Buffer.from("ciphertext"),
      encryption,
    });

    const next = {
      format: "OCE1" as const,
      wrappedKey: "C".repeat(96),
      metadataBlob: "D".repeat(120),
      keyEpoch: 1,
    };
    const replaced = await files.upload(user.id, {
      folderId: null,
      name: "secret.bin",
      data: Buffer.from("next ciphertext"),
      replaceFileId: first.id,
      encryption: next,
    });

    expect(replaced.encryptionFormat).toBe("OCE1");
    expect(replaced.wrappedKey).toBe(next.wrappedKey);
    expect(replaced.metadataBlob).toBe(next.metadataBlob);
    expect(replaced.keyEpoch).toBe(1);

    const versions = await repos.files.listVersions(first.id);
    expect(versions[0]!.wrappedKey).toBe(next.wrappedKey);
    expect(versions[1]!.wrappedKey).toBe(encryption.wrappedKey);
  });
});
