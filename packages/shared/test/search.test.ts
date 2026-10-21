import { describe, expect, it } from "vitest";
import { filterByListQuery, matchesListQuery, type SearchableItem } from "../src/search";
import type { ListQuery } from "../src/query";

const item = (overrides: Partial<SearchableItem> = {}): SearchableItem => ({
  id: "file-1",
  name: "report.pdf",
  mimeType: "application/pdf",
  size: 2097152,
  folderId: "folder-1",
  starred: true,
  trashed: false,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
  ...overrides,
});

/** The API's default scope: active items only. */
const active: ListQuery = { status: "active" };

describe("matching a query against an item", () => {
  it("matches an ordinary item with no filters", () => {
    expect(matchesListQuery(item(), {})).toBe(true);
  });

  it("excludes a trashed item unless the query asks for it", () => {
    const trashed = item({ trashed: true });
    expect(matchesListQuery(trashed, active)).toBe(false);
    expect(matchesListQuery(trashed, { status: "trashed" })).toBe(true);
    expect(matchesListQuery(trashed, { status: "all" })).toBe(true);
  });

  it("matches a name substring case-insensitively", () => {
    expect(matchesListQuery(item(), { ...active, q: "report" })).toBe(true);
    expect(matchesListQuery(item(), { ...active, q: "REPORT" })).toBe(true);
    expect(matchesListQuery(item(), { ...active, q: "invoice" })).toBe(false);
  });

  it("matches an extension case-insensitively", () => {
    expect(matchesListQuery(item(), { ...active, ext: "pdf" })).toBe(true);
    expect(matchesListQuery(item(), { ...active, ext: "PDF" })).toBe(true);
    expect(matchesListQuery(item(), { ...active, ext: ".pdf" })).toBe(true);
    expect(matchesListQuery(item(), { ...active, ext: "docx" })).toBe(false);
  });

  it("matches a coarse type category", () => {
    expect(matchesListQuery(item(), { ...active, type: "pdf" })).toBe(true);
    expect(matchesListQuery(item(), { ...active, type: "document" })).toBe(false);
    expect(
      matchesListQuery(item({ mimeType: "image/png", name: "a.png" }), {
        ...active,
        type: "image",
      }),
    ).toBe(true);
  });

  it("matches an exact MIME type", () => {
    expect(matchesListQuery(item(), { ...active, type: "application/pdf" })).toBe(true);
    expect(matchesListQuery(item(), { ...active, type: "application/zip" })).toBe(false);
  });

  it("matches size bounds", () => {
    expect(matchesListQuery(item(), { ...active, minSize: 1024 })).toBe(true);
    expect(matchesListQuery(item(), { ...active, minSize: 10 * 1024 * 1024 })).toBe(false);
    expect(matchesListQuery(item(), { ...active, maxSize: 1024 })).toBe(false);
  });

  it("matches date bounds against the created date, as the server does", () => {
    expect(matchesListQuery(item(), { ...active, from: "2026-09-01" })).toBe(true);
    expect(matchesListQuery(item(), { ...active, from: "2026-11-01" })).toBe(false);
    expect(matchesListQuery(item(), { ...active, to: "2026-09-01" })).toBe(false);
    // A later updated date does not widen the created-date bound.
    expect(
      matchesListQuery(item({ createdAt: "2026-01-01T00:00:00.000Z" }), {
        ...active,
        from: "2026-09-01",
      }),
    ).toBe(false);
  });

  it("matches the starred flag", () => {
    expect(matchesListQuery(item(), { ...active, starred: true })).toBe(true);
    expect(matchesListQuery(item(), { ...active, starred: false })).toBe(false);
  });

  it("matches a folder", () => {
    expect(matchesListQuery(item(), { ...active, folderId: "folder-1" })).toBe(true);
    expect(matchesListQuery(item(), { ...active, folderId: "folder-2" })).toBe(false);
    expect(matchesListQuery(item({ folderId: null }), { ...active, folderId: null })).toBe(true);
  });

  it("matches a resolved set of folders", () => {
    const options = { folderIds: ["folder-2", "folder-3"] };
    expect(matchesListQuery(item(), { ...active }, options)).toBe(false);
    expect(matchesListQuery(item({ folderId: "folder-3" }), { ...active }, options)).toBe(true);
  });

  it("excludes an item with no type when a type is asked for", () => {
    expect(matchesListQuery(item({ mimeType: null }), { ...active, type: "image" })).toBe(false);
  });
});

describe("filtering a list", () => {
  const items = [
    item({ id: "a", name: "alpha.pdf", starred: false }),
    item({ id: "b", name: "beta.png", mimeType: "image/png", size: 1024 }),
    item({ id: "c", name: "gamma.txt", mimeType: "text/plain" }),
  ];

  it("keeps the order it was given", () => {
    expect(filterByListQuery(items, active).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("filters by name", () => {
    expect(filterByListQuery(items, { ...active, q: "beta" }).map((i) => i.id)).toEqual(["b"]);
  });

  it("filters by type", () => {
    expect(filterByListQuery(items, { ...active, type: "image" }).map((i) => i.id)).toEqual(["b"]);
  });

  it("filters by several conditions at once", () => {
    const result = filterByListQuery(items, { ...active, type: "image", maxSize: 2048 });
    expect(result.map((i) => i.id)).toEqual(["b"]);
  });
});
