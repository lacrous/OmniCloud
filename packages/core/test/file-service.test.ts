import { beforeEach, describe, expect, it } from "vitest";
import { FileService } from "../src/services/file-service";
import { FolderService } from "../src/services/folder-service";
import { StorageEngine } from "../src/storage/engine";
import { sha256Hex } from "../src/utils/hash";
import { NotFoundError, ValidationError } from "../src/errors";
import { FakeStorageProvider, createInMemoryRepos, makeUser } from "./fakes";

let repos: ReturnType<typeof createInMemoryRepos>;
let provider: FakeStorageProvider;
let files: FileService;
let folders: FolderService;
let user: ReturnType<typeof makeUser>;

beforeEach(() => {
  repos = createInMemoryRepos();
  provider = new FakeStorageProvider();
  const engineFor = async () => new StorageEngine(provider);
  files = new FileService(repos.files, repos.folders, engineFor);
  folders = new FolderService(repos.folders, repos.files, engineFor);
  user = makeUser("100");
  repos._users.push(user);
});

describe("FileService.upload", () => {
  it("persists metadata only after the provider succeeds", async () => {
    provider.failNextPut = true;
    await expect(
      files.upload(user.id, { folderId: null, name: "test.pdf", data: Buffer.from("hello") }),
    ).rejects.toThrow();
    expect(repos._files.length).toBe(0);
    expect(provider.objects.size).toBe(0);
  });

  it("stores the SHA-256 checksum and derived MIME type", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: "test.pdf",
      data: Buffer.from("hello"),
    });
    expect(record.sha256).toBe(sha256Hex(Buffer.from("hello")));
    expect(record.mimeType).toBe("application/pdf");
    expect(record.size).toBe(5);
    expect(provider.objects.size).toBe(1);
  });

  it("uploads into an owned folder and rejects foreign folders", async () => {
    const folder = await folders.create(user.id, { name: "Docs", parentId: null });
    const record = await files.upload(user.id, {
      folderId: folder.id,
      name: "test.pdf",
      data: Buffer.from("data"),
    });
    expect(record.folderId).toBe(folder.id);

    await expect(
      files.upload(user.id, { folderId: "missing-folder", name: "x", data: Buffer.from("x") }),
    ).rejects.toThrow(NotFoundError);
  });

  it("rejects names that sanitize to nothing", async () => {
    await expect(
      files.upload(user.id, { folderId: null, name: "..", data: Buffer.from("x") }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("FileService ownership", () => {
  it("hides other users' files", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: "a.txt",
      data: Buffer.from("a"),
    });
    const stranger = makeUser("999");
    repos._users.push(stranger);
    await expect(files.get(stranger.id, record.id)).rejects.toThrow(NotFoundError);
    await expect(files.download(stranger.id, record.id)).rejects.toThrow(NotFoundError);
  });
});

describe("FileService.rename / move", () => {
  it("renames a file", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: "a.txt",
      data: Buffer.from("a"),
    });
    const renamed = await files.rename(user.id, record.id, "b.txt");
    expect(renamed.name).toBe("b.txt");
  });

  it("moves a file between folders and to root", async () => {
    const f1 = await folders.create(user.id, { name: "F1", parentId: null });
    const f2 = await folders.create(user.id, { name: "F2", parentId: null });
    const record = await files.upload(user.id, {
      folderId: f1.id,
      name: "a.txt",
      data: Buffer.from("a"),
    });

    const moved = await files.move(user.id, record.id, f2.id);
    expect(moved.folderId).toBe(f2.id);

    const backToRoot = await files.move(user.id, record.id, null);
    expect(backToRoot.folderId).toBeNull();
  });
});

describe("FileService.delete", () => {
  it("removes the remote object and the metadata", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: "a.txt",
      data: Buffer.from("a"),
    });
    const messageId = [...provider.objects.keys()][0]!;

    await files.delete(user.id, record.id);

    expect(provider.objects.has(messageId)).toBe(false);
    expect(repos._files.length).toBe(0);
  });
});

describe("FileService.download", () => {
  it("returns the original bytes with integrity verified", async () => {
    const payload = Buffer.from("The quick brown fox");
    const record = await files.upload(user.id, { folderId: null, name: "a.txt", data: payload });

    const result = await files.download(user.id, record.id);
    expect(result.data.equals(payload)).toBe(true);
    expect(result.integrityVerified).toBe(true);
  });

  it("reports integrity failure when remote data was tampered with", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: "a.txt",
      data: Buffer.from("a"),
    });
    const messageId = [...provider.objects.keys()][0]!;
    provider.objects.set(messageId, {
      name: "a.txt",
      mimeType: "text/plain",
      data: Buffer.from("tampered"),
    });

    const result = await files.download(user.id, record.id);
    expect(result.integrityVerified).toBe(false);
  });
});
