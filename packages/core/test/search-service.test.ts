import { beforeEach, describe, expect, it } from "vitest";
import { ValidationError } from "../src/errors";
import { FileService } from "../src/services/file-service";
import { FolderService } from "../src/services/folder-service";
import { SearchService } from "../src/services/search-service";
import { StorageEngine } from "../src/storage/engine";
import { FakeStorageProvider, createInMemoryRepos, makeUser, type InMemoryRepos } from "./fakes";

let repos: InMemoryRepos;
let search: SearchService;
let files: FileService;
let folders: FolderService;
let user: ReturnType<typeof makeUser>;

const PAGE = { page: 1, limit: 50 };

beforeEach(async () => {
  repos = createInMemoryRepos();
  const engineFor = async () => new StorageEngine(new FakeStorageProvider());
  search = new SearchService(repos.files, repos.folders);
  files = new FileService(repos.files, repos.folders, engineFor);
  folders = new FolderService(repos.folders, repos.files, engineFor);
  user = makeUser("100");
  repos._users.push(user);

  await files.upload(user.id, { folderId: null, name: "report.pdf", data: Buffer.alloc(2048) });
  await files.upload(user.id, { folderId: null, name: "holiday.png", data: Buffer.alloc(4096) });
  await files.upload(user.id, { folderId: null, name: "archive.zip", data: Buffer.alloc(512) });
  await files.upload(user.id, { folderId: null, name: "notes.txt", data: Buffer.alloc(64) });
  await folders.create(user.id, { name: "Projects", parentId: null });
  await folders.create(user.id, { name: "Archive", parentId: null });
});

describe("search query language", () => {
  it("matches names case-insensitively by default", async () => {
    const result = await search.search(user.id, "REPORT", PAGE);
    expect(result.files.map((f) => f.name)).toEqual(["report.pdf"]);
  });

  it("filters by extension", async () => {
    const result = await search.search(user.id, "ext:pdf", PAGE);
    expect(result.files.map((f) => f.name)).toEqual(["report.pdf"]);
  });

  it("filters by coarse category", async () => {
    const images = await search.search(user.id, "type:image", PAGE);
    expect(images.files.map((f) => f.name)).toEqual(["holiday.png"]);

    const archives = await search.search(user.id, "type:archive", PAGE);
    expect(archives.files.map((f) => f.name)).toEqual(["archive.zip"]);
  });

  it("filters by exact MIME type", async () => {
    const result = await search.search(user.id, "type:application/pdf", PAGE);
    expect(result.files.map((f) => f.name)).toEqual(["report.pdf"]);
  });

  it("filters by size comparison", async () => {
    // report.pdf = 2048, holiday.png = 4096, archive.zip = 512, notes.txt = 64
    const large = await search.search(user.id, "size:>=2KB", PAGE);
    expect(large.files.map((f) => f.name).sort()).toEqual(["holiday.png", "report.pdf"]);

    const small = await search.search(user.id, "size:<1KB", PAGE);
    expect(small.files.map((f) => f.name).sort()).toEqual(["archive.zip", "notes.txt"]);
  });

  it("resolves folder:Name to a folder filter", async () => {
    const projects = await folders.listChildren(user.id, null);
    const target = projects.find((f) => f.name === "Projects")!;
    await files.upload(user.id, {
      folderId: target.id,
      name: "inside.txt",
      data: Buffer.alloc(10),
    });

    const result = await search.search(user.id, "folder:Projects", PAGE);
    expect(result.files.map((f) => f.name)).toEqual(["inside.txt"]);
  });

  it("combines name terms with structured filters", async () => {
    const result = await search.search(user.id, "name:holiday type:image", PAGE);
    expect(result.files.map((f) => f.name)).toEqual(["holiday.png"]);
  });

  it("treats unknown field tokens as literal search terms", async () => {
    const result = await search.search(user.id, "weird:thing", PAGE);
    expect(result.files).toHaveLength(0);
    expect(result.folders).toHaveLength(0);
  });

  it("honors starred and trashed filters", async () => {
    const starredFile = repos._files.find((f) => f.name === "notes.txt")!;
    await files.setStarred(user.id, starredFile.id, true);

    const starred = await search.search(user.id, "starred:true", PAGE);
    expect(starred.files.map((f) => f.name)).toEqual(["notes.txt"]);

    await files.trash(user.id, starredFile.id);
    const trashed = await search.search(user.id, "trashed:true", PAGE);
    expect(trashed.files.map((f) => f.name)).toEqual(["notes.txt"]);

    // Default search covers both active and trashed.
    const all = await search.search(user.id, "notes", PAGE);
    expect(all.files.map((f) => f.name)).toEqual(["notes.txt"]);
  });

  it("rejects empty and oversized queries", async () => {
    await expect(search.search(user.id, "   ", PAGE)).rejects.toThrow(ValidationError);
    await expect(search.search(user.id, "x".repeat(300), PAGE)).rejects.toThrow(ValidationError);
  });

  it("never returns another user's data", async () => {
    const stranger = makeUser("999");
    repos._users.push(stranger);
    await files.upload(stranger.id, { folderId: null, name: "secret.txt", data: Buffer.alloc(10) });

    const result = await search.search(user.id, "secret", PAGE);
    expect(result.files).toHaveLength(0);
  });
});

describe("sorting and pagination", () => {
  it("sorts by name ascending and descending", async () => {
    const asc = await files.query(user.id, { sort: "name", order: "asc" }, PAGE);
    expect(asc.items.map((f) => f.name)).toEqual([
      "archive.zip",
      "holiday.png",
      "notes.txt",
      "report.pdf",
    ]);

    const desc = await files.query(user.id, { sort: "name", order: "desc" }, PAGE);
    expect(desc.items[0]!.name).toBe("report.pdf");
  });

  it("sorts by size", async () => {
    const result = await files.query(user.id, { sort: "size", order: "desc" }, PAGE);
    expect(result.items.map((f) => f.size)).toEqual([4096, 2048, 512, 64]);
  });

  it("paginates with an accurate total", async () => {
    const page1 = await files.query(user.id, { sort: "name", order: "asc" }, { page: 1, limit: 2 });
    expect(page1.items.map((f) => f.name)).toEqual(["archive.zip", "holiday.png"]);
    expect(page1.total).toBe(4);

    const page2 = await files.query(user.id, { sort: "name", order: "asc" }, { page: 2, limit: 2 });
    expect(page2.items.map((f) => f.name)).toEqual(["notes.txt", "report.pdf"]);
  });
});
