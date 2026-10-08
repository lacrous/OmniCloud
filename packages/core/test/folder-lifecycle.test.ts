import { beforeEach, describe, expect, it } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "../src/errors";
import { FileService } from "../src/services/file-service";
import { FolderService } from "../src/services/folder-service";
import { TrashService } from "../src/services/trash-service";
import { StorageEngine } from "../src/storage/engine";
import { FakeStorageProvider, createInMemoryRepos, makeUser, type InMemoryRepos } from "./fakes";

let repos: InMemoryRepos;
let provider: FakeStorageProvider;
let files: FileService;
let folders: FolderService;
let trash: TrashService;
let user: ReturnType<typeof makeUser>;

beforeEach(() => {
  repos = createInMemoryRepos();
  provider = new FakeStorageProvider();
  const engineFor = async () => new StorageEngine(provider);
  files = new FileService(repos.files, repos.folders, engineFor);
  folders = new FolderService(repos.folders, repos.files, engineFor);
  trash = new TrashService(repos.files, repos.folders, engineFor);
  user = makeUser("100");
  repos._users.push(user);
});

async function tree() {
  const root = await folders.create(user.id, { name: "Root", parentId: null });
  const child = await folders.create(user.id, { name: "Child", parentId: root.id });
  const grandchild = await folders.create(user.id, { name: "Grand", parentId: child.id });
  const other = await folders.create(user.id, { name: "Other", parentId: null });

  const inRoot = await files.upload(user.id, {
    folderId: root.id,
    name: "root.txt",
    data: Buffer.from("r"),
  });
  const inChild = await files.upload(user.id, {
    folderId: child.id,
    name: "child.txt",
    data: Buffer.from("c"),
  });
  const inOther = await files.upload(user.id, {
    folderId: other.id,
    name: "other.txt",
    data: Buffer.from("o"),
  });

  return { root, child, grandchild, other, inRoot, inChild, inOther };
}

describe("folder create / move guards", () => {
  it("rejects creating a folder inside a trashed parent", async () => {
    const parent = await folders.create(user.id, { name: "P", parentId: null });
    await folders.trash(user.id, parent.id);
    await expect(folders.create(user.id, { name: "C", parentId: parent.id })).rejects.toThrow(
      ConflictError,
    );
  });

  it("rejects moving a folder into itself or a descendant", async () => {
    const a = await folders.create(user.id, { name: "A", parentId: null });
    const b = await folders.create(user.id, { name: "B", parentId: a.id });
    const c = await folders.create(user.id, { name: "C", parentId: b.id });

    await expect(folders.move(user.id, a.id, a.id)).rejects.toThrow(ValidationError);
    await expect(folders.move(user.id, a.id, b.id)).rejects.toThrow(ValidationError);
    await expect(folders.move(user.id, a.id, c.id)).rejects.toThrow(ValidationError);
  });

  it("blocks moving into another user's folder", async () => {
    const stranger = makeUser("999");
    repos._users.push(stranger);
    const mine = await folders.create(user.id, { name: "Mine", parentId: null });
    const theirs = await folders.create(stranger.id, { name: "Theirs", parentId: null });

    await expect(folders.move(user.id, mine.id, theirs.id)).rejects.toThrow(NotFoundError);
  });
});

describe("folder trash cascade", () => {
  it("trashes the whole subtree without touching Telegram", async () => {
    const { root, inRoot, inChild, inOther } = await tree();
    const objectsBefore = provider.objects.size;

    const result = await folders.trash(user.id, root.id);

    expect(result.affectedFolders).toBe(3); // Root, Child, Grand
    expect(result.affectedFiles).toBe(2); // root.txt, child.txt
    expect(provider.objects.size).toBe(objectsBefore); // nothing deleted remotely

    // Trashed items disappear from active folder listings.
    const activeChildren = await folders.listChildren(user.id, null);
    expect(activeChildren.map((f) => f.name)).toEqual(["Other"]);

    // The untouched sibling keeps its file.
    expect((await files.getActive(user.id, inOther.id)).deletedAt).toBeNull();
    expect((await repos.files.findById(inRoot.id))!.deletedAt).not.toBeNull();
    expect((await repos.files.findById(inChild.id))!.deletedAt).not.toBeNull();
  });

  it("restores the subtree losslessly", async () => {
    const { root, inRoot, inChild } = await tree();
    await folders.trash(user.id, root.id);

    const result = await folders.restore(user.id, root.id);

    expect(result.affectedFolders).toBe(3);
    expect(result.affectedFiles).toBe(2);

    const active = await folders.listChildren(user.id, null);
    expect(active.map((f) => f.name).sort()).toEqual(["Other", "Root"]);
    expect((await files.getActive(user.id, inRoot.id)).id).toBe(inRoot.id);
    expect((await files.getActive(user.id, inChild.id)).id).toBe(inChild.id);
  });

  it("restores only items trashed together, leaving separately-trashed items", async () => {
    const { root, child, inRoot, inChild } = await tree();

    // Trash one file on its own first...
    await files.trash(user.id, inChild.id);
    const separatelyTrashedAt = (await repos.files.findById(inChild.id))!.deletedAt;

    // ...then trash the whole folder (which stamps a different timestamp).
    await folders.trash(user.id, root.id);
    await folders.restore(user.id, root.id);

    // The folder and its own file come back...
    expect((await repos.folders.findById(child.id))!.deletedAt).toBeNull();
    expect((await repos.files.findById(inRoot.id))!.deletedAt).toBeNull();
    // ...but the separately-trashed file stays in the Trash.
    const stillTrashed = (await repos.files.findById(inChild.id))!.deletedAt;
    expect(stillTrashed?.getTime()).toBe(separatelyTrashedAt?.getTime());
  });

  it("restores to root when the parent chain is trashed", async () => {
    const { root, child } = await tree();
    // Trash the parent first, then the child independently.
    await folders.trash(user.id, root.id);
    await folders.restore(user.id, child.id);
    // The child's parent is still trashed, so it is reparented to root.
    expect((await repos.folders.findById(child.id))!.parentId).toBeNull();
  });
});

describe("folder permanent delete", () => {
  it("removes remote objects and metadata for the subtree", async () => {
    const { root, inOther } = await tree();

    const result = await folders.deletePermanently(user.id, root.id);

    expect(result.affectedFolders).toBe(3);
    expect(result.affectedFiles).toBe(2);
    expect(provider.objects.size).toBe(1); // only other.txt remains
    expect(repos._files.map((f) => f.name)).toEqual(["other.txt"]);
    expect((await files.getActive(user.id, inOther.id)).id).toBe(inOther.id);
  });

  it("keeps a file and its folder when the remote delete fails", async () => {
    const { root, inRoot } = await tree();
    provider.failAllDeletes = true;

    const result = await folders.deletePermanently(user.id, root.id);

    // Nothing could be deleted, so no folder is removed either.
    expect(result.affectedFiles).toBe(0);
    expect(repos._files.some((f) => f.id === inRoot.id)).toBe(true);
    expect(repos._folders.some((f) => f.id === root.id)).toBe(true);
  });

  it("does not touch another user's data", async () => {
    const stranger = makeUser("999");
    repos._users.push(stranger);
    const theirs = await folders.create(stranger.id, { name: "Theirs", parentId: null });
    await files.upload(stranger.id, {
      folderId: theirs.id,
      name: "x.txt",
      data: Buffer.from("x"),
    });

    await expect(folders.deletePermanently(user.id, theirs.id)).rejects.toThrow(NotFoundError);
    expect(provider.objects.size).toBe(1);
  });
});

describe("trash service", () => {
  it("lists only trashed items", async () => {
    const { root, inOther } = await tree();
    await folders.trash(user.id, root.id);

    const listing = await trash.list(user.id, { page: 1, limit: 50 });
    expect(listing.folders.map((f) => f.name).sort()).toEqual(["Child", "Grand", "Root"]);
    expect(listing.files.map((f) => f.name).sort()).toEqual(["child.txt", "root.txt"]);
    expect(listing.files.some((f) => f.id === inOther.id)).toBe(false);
  });

  it("empties the trash permanently, reporting counts", async () => {
    const { root } = await tree();
    await folders.trash(user.id, root.id);

    const result = await trash.empty(user.id);

    expect(result.deletedFiles).toBe(2);
    expect(result.deletedFolders).toBe(3);
    expect(result.failedFiles).toBe(0);
    expect(provider.objects.size).toBe(1); // other.txt survives
  });

  it("reports files it could not delete instead of hiding the failure", async () => {
    const record = await files.upload(user.id, {
      folderId: null,
      name: "stuck.txt",
      data: Buffer.from("s"),
    });
    await files.trash(user.id, record.id);
    provider.failAllDeletes = true;

    const result = await trash.empty(user.id);

    expect(result.failedFiles).toBe(1);
    expect(result.deletedFiles).toBe(0);
    expect(repos._files).toHaveLength(1); // metadata retained for retry
  });
});
