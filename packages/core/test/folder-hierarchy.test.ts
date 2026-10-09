import { beforeEach, describe, expect, it } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "../src/errors";
import { ActivityService } from "../src/services/activity-service";
import { FileService } from "../src/services/file-service";
import { FolderService } from "../src/services/folder-service";
import { StorageEngine } from "../src/storage/engine";
import { FakeStorageProvider, createInMemoryRepos, makeUser, type InMemoryRepos } from "./fakes";

let repos: InMemoryRepos;
let files: FileService;
let folders: FolderService;
let user: ReturnType<typeof makeUser>;

beforeEach(() => {
  repos = createInMemoryRepos();
  const engine = new StorageEngine(new FakeStorageProvider(), { attempts: 1, baseDelayMs: 0 });
  const engineFor = async () => engine;
  const activity = new ActivityService(repos.activity);
  files = new FileService(repos.files, repos.folders, engineFor, activity);
  folders = new FolderService(repos.folders, repos.files, engineFor, activity);
  user = makeUser();
});

/** A → B → C chain, plus an unrelated sibling D. */
async function chain() {
  const a = await folders.create(user.id, { name: "A", parentId: null });
  const b = await folders.create(user.id, { name: "B", parentId: a.id });
  const c = await folders.create(user.id, { name: "C", parentId: b.id });
  const d = await folders.create(user.id, { name: "D", parentId: null });
  return { a, b, c, d };
}

const parentOf = async (id: string) => (await repos.folders.findById(id))!.parentId;

describe("folder hierarchy: moves", () => {
  it("refuses to move a folder into itself", async () => {
    const { a } = await chain();
    await expect(folders.move(user.id, a.id, a.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses to move a folder into its own child", async () => {
    const { a, b } = await chain();
    await expect(folders.move(user.id, a.id, b.id)).rejects.toBeInstanceOf(ValidationError);
    expect(await parentOf(a.id)).toBeNull();
  });

  it("refuses to move a folder into a grandchild", async () => {
    const { a, c } = await chain();
    await expect(folders.move(user.id, a.id, c.id)).rejects.toBeInstanceOf(ValidationError);
    expect(await parentOf(a.id)).toBeNull();
  });

  it("moving a folder to its own current parent leaves the hierarchy unchanged", async () => {
    const { b, a } = await chain();
    await folders.move(user.id, b.id, a.id);
    expect(await parentOf(b.id)).toBe(a.id);
  });

  it("refuses to move into a trashed folder", async () => {
    const { a, d } = await chain();
    await folders.trash(user.id, d.id);
    await expect(folders.move(user.id, a.id, d.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("never lets a moved folder become its own ancestor, under any sequence", async () => {
    const { a, b, c, d } = await chain();
    await folders.move(user.id, d.id, c.id);
    await expect(folders.move(user.id, a.id, d.id)).rejects.toBeInstanceOf(ValidationError);
    // Walk every chain upward: it must terminate at the root.
    for (const start of [a.id, b.id, c.id, d.id]) {
      const seen = new Set<string>();
      let cursor: string | null = start;
      while (cursor !== null) {
        expect(seen.has(cursor)).toBe(false);
        seen.add(cursor);
        cursor = await parentOf(cursor);
      }
    }
  });
});

describe("folder hierarchy: restore edge cases", () => {
  it("restoring a subfolder whose parent is still trashed reattaches it to the root", async () => {
    const { a, b } = await chain();
    await folders.trash(user.id, a.id);
    await folders.restore(user.id, b.id);
    expect(await parentOf(b.id)).toBeNull();
  });

  it("restoring a nested folder brings back its own subtree", async () => {
    const { a, b, c } = await chain();
    await folders.trash(user.id, a.id);
    await folders.restore(user.id, a.id);
    expect(await parentOf(b.id)).toBe(a.id);
    expect(await parentOf(c.id)).toBe(b.id);
    expect((await repos.folders.findById(c.id))!.deletedAt).toBeNull();
  });

  it("does not restore a folder into a trashed parent", async () => {
    const { a, b } = await chain();
    await folders.trash(user.id, a.id);
    await folders.restore(user.id, b.id);
    const restored = await repos.folders.findById(b.id);
    const parent = restored!.parentId ? await repos.folders.findById(restored!.parentId) : null;
    expect(parent === null || parent.deletedAt === null).toBe(true);
  });

  it("restore cannot create a cycle, even after moves made while trashed", async () => {
    const { a, b, c } = await chain();
    await folders.trash(user.id, b.id);
    await folders.restore(user.id, b.id);
    await expect(folders.move(user.id, a.id, c.id)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("folder hierarchy: nested delete", () => {
  it("trashing a parent trashes every nested folder and file together", async () => {
    const { a, b, c } = await chain();
    const inC = await files.upload(user.id, {
      folderId: c.id,
      name: "c.txt",
      data: Buffer.from("c"),
    });
    await folders.trash(user.id, a.id);
    expect((await repos.folders.findById(b.id))!.deletedAt).not.toBeNull();
    expect((await repos.folders.findById(c.id))!.deletedAt).not.toBeNull();
    expect((await repos.files.findById(inC.id))!.deletedAt).not.toBeNull();
  });

  it("a deep recursive permanent delete removes the whole subtree and nothing else", async () => {
    const { a, d } = await chain();
    await folders.trash(user.id, a.id);
    await folders.deletePermanently(user.id, a.id);
    expect(await repos.folders.findById(a.id)).toBeNull();
    expect((await repos.folders.findById(d.id))!.id).toBe(d.id);
  });

  it("a missing folder reports NotFound rather than succeeding silently", async () => {
    await expect(folders.get(user.id, "no-such-folder")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("folder hierarchy: names", () => {
  it("allows two folders with the same name under one parent (names are not unique)", async () => {
    const parent = await folders.create(user.id, { name: "P", parentId: null });
    await folders.create(user.id, { name: "Same", parentId: parent.id });
    await expect(
      folders.create(user.id, { name: "Same", parentId: parent.id }),
    ).resolves.toBeDefined();
  });

  it("renaming to an existing sibling name is allowed, consistently with create", async () => {
    const parent = await folders.create(user.id, { name: "P", parentId: null });
    await folders.create(user.id, { name: "Taken", parentId: parent.id });
    const other = await folders.create(user.id, { name: "Other", parentId: parent.id });
    await expect(folders.rename(user.id, other.id, "Taken")).resolves.toMatchObject({
      name: "Taken",
    });
  });
});
