import { beforeEach, describe, expect, it } from "vitest";
import { FolderService } from "../src/services/folder-service";
import { FileService } from "../src/services/file-service";
import { StorageEngine } from "../src/storage/engine";
import { NotFoundError, ValidationError } from "../src/errors";
import { FakeStorageProvider, createInMemoryRepos, makeUser } from "./fakes";

let repos: ReturnType<typeof createInMemoryRepos>;
let provider: FakeStorageProvider;
let folders: FolderService;
let files: FileService;
let userA: ReturnType<typeof makeUser>;
let userB: ReturnType<typeof makeUser>;

beforeEach(() => {
  repos = createInMemoryRepos();
  provider = new FakeStorageProvider();
  const engineFor = async () => new StorageEngine(provider);
  folders = new FolderService(repos.folders, repos.files, engineFor);
  files = new FileService(repos.files, repos.folders, engineFor);
  userA = makeUser("101");
  userB = makeUser("102");
  repos._users.push(userA, userB);
});

describe("FolderService.create", () => {
  it("creates a root folder", async () => {
    const folder = await folders.create(userA.id, { name: "Documents", parentId: null });
    expect(folder.name).toBe("Documents");
    expect(folder.parentId).toBeNull();
  });

  it("creates a nested folder inside an owned parent", async () => {
    const parent = await folders.create(userA.id, { name: "Documents", parentId: null });
    const child = await folders.create(userA.id, { name: "Work", parentId: parent.id });
    expect(child.parentId).toBe(parent.id);
  });

  it("rejects creation inside another user's folder", async () => {
    const foreign = await folders.create(userB.id, { name: "Foreign", parentId: null });
    await expect(
      folders.create(userA.id, { name: "Sneaky", parentId: foreign.id }),
    ).rejects.toThrow(NotFoundError);
  });

  it("rejects invalid names", async () => {
    await expect(folders.create(userA.id, { name: "  ", parentId: null })).rejects.toThrow(
      ValidationError,
    );
    await expect(folders.create(userA.id, { name: "..", parentId: null })).rejects.toThrow(
      ValidationError,
    );
  });
});

describe("FolderService.move", () => {
  it("moves a folder into another folder", async () => {
    const a = await folders.create(userA.id, { name: "A", parentId: null });
    const b = await folders.create(userA.id, { name: "B", parentId: null });
    const moved = await folders.move(userA.id, a.id, b.id);
    expect(moved.parentId).toBe(b.id);
  });

  it("rejects moving a folder into itself", async () => {
    const a = await folders.create(userA.id, { name: "A", parentId: null });
    await expect(folders.move(userA.id, a.id, a.id)).rejects.toThrow(ValidationError);
  });

  it("rejects moving a folder into one of its descendants", async () => {
    const a = await folders.create(userA.id, { name: "A", parentId: null });
    const child = await folders.create(userA.id, { name: "Child", parentId: a.id });
    const grandchild = await folders.create(userA.id, { name: "GC", parentId: child.id });
    await expect(folders.move(userA.id, a.id, child.id)).rejects.toThrow(ValidationError);
    await expect(folders.move(userA.id, a.id, grandchild.id)).rejects.toThrow(ValidationError);
  });

  it("rejects moves referencing another user's folder", async () => {
    const mine = await folders.create(userA.id, { name: "Mine", parentId: null });
    const foreign = await folders.create(userB.id, { name: "Foreign", parentId: null });
    await expect(folders.move(userA.id, mine.id, foreign.id)).rejects.toThrow(NotFoundError);
  });
});

describe("FolderService.delete (cascade)", () => {
  it("deletes descendants and their files, including remote objects", async () => {
    const root = await folders.create(userA.id, { name: "Root", parentId: null });
    const child = await folders.create(userA.id, { name: "Child", parentId: root.id });
    const other = await folders.create(userA.id, { name: "Other", parentId: null });

    await files.upload(userA.id, { folderId: root.id, name: "a.txt", data: Buffer.from("a") });
    await files.upload(userA.id, { folderId: child.id, name: "b.txt", data: Buffer.from("b") });
    await files.upload(userA.id, { folderId: other.id, name: "c.txt", data: Buffer.from("c") });
    const objectCountBefore = provider.objects.size;

    const result = await folders.delete(userA.id, root.id);

    expect(result).toEqual({ deletedFolders: 2, deletedFiles: 2 });
    expect(repos._folders.map((f) => f.name)).toEqual(["Other"]);
    expect(repos._files.map((f) => f.name)).toEqual(["c.txt"]);
    expect(provider.objects.size).toBe(objectCountBefore - 2);
  });

  it("does not touch another user's data", async () => {
    const foreignRoot = await folders.create(userB.id, { name: "Foreign", parentId: null });
    await files.upload(userB.id, {
      folderId: foreignRoot.id,
      name: "x.txt",
      data: Buffer.from("x"),
    });
    const foreignId = foreignRoot.id;

    await expect(folders.delete(userA.id, foreignId)).rejects.toThrow(NotFoundError);
    expect(repos._folders.length).toBe(1);
    expect(provider.objects.size).toBe(1);
  });
});
