import { beforeEach, describe, expect, it } from "vitest";
import { SearchService } from "../src/services/search-service";
import { FileService } from "../src/services/file-service";
import { FolderService } from "../src/services/folder-service";
import { StorageEngine } from "../src/storage/engine";
import { ValidationError } from "../src/errors";
import { FakeStorageProvider, createInMemoryRepos, makeUser } from "./fakes";

let repos: ReturnType<typeof createInMemoryRepos>;
let search: SearchService;
let files: FileService;
let folders: FolderService;
let user: ReturnType<typeof makeUser>;

beforeEach(() => {
  repos = createInMemoryRepos();
  const engineFor = async () => new StorageEngine(new FakeStorageProvider());
  search = new SearchService(repos.files, repos.folders);
  files = new FileService(repos.files, repos.folders, engineFor);
  folders = new FolderService(repos.folders, repos.files, engineFor);
  user = makeUser("100");
  repos._users.push(user);
});

describe("SearchService", () => {
  it("finds files and folders by partial, case-insensitive name", async () => {
    await files.upload(user.id, {
      folderId: null,
      name: "Project-Plan.pdf",
      data: Buffer.from("p"),
    });
    await files.upload(user.id, { folderId: null, name: "holiday.jpg", data: Buffer.from("h") });
    await folders.create(user.id, { name: "Projects", parentId: null });

    const result = await search.search(user.id, "project");

    expect(result.files.map((f) => f.name)).toEqual(["Project-Plan.pdf"]);
    expect(result.folders.map((f) => f.name)).toEqual(["Projects"]);
  });

  it("does not leak other users' data", async () => {
    const stranger = makeUser("200");
    repos._users.push(stranger);
    await files.upload(stranger.id, { folderId: null, name: "secret.txt", data: Buffer.from("s") });

    const result = await search.search(user.id, "secret");
    expect(result.files).toHaveLength(0);
  });

  it("rejects empty queries", async () => {
    await expect(search.search(user.id, "   ")).rejects.toThrow(ValidationError);
  });
});
