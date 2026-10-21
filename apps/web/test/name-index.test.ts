import { describe, expect, it } from "vitest";
import type { IndexEntry } from "@omnicloud/crypto";
import { createIndexContainer, generateUrk, openIndexContainer } from "@omnicloud/crypto";
import { matchesListQuery, type SearchableItem } from "@omnicloud/shared";

/**
 * The crypto package holds the index entry and the shared package holds the
 * search interface, and neither depends on the other. This file is where the
 * two are checked against each other: the web app depends on both, so a change
 * to one that breaks the other is caught here rather than at runtime.
 */
const entry: IndexEntry = {
  id: "cmux72xpt0008mcvg8bsv9quk",
  name: "report.pdf",
  mimeType: "application/pdf",
  description: "Q3 numbers",
  size: 2097152,
  folderId: "cmux76h8s0004mczja52i07i8",
  starred: true,
  trashed: false,
  versionCount: 2,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
};

// A compile-time check: an index entry must be searchable as it is. If the
// shared interface gains a field the crypto entry does not have, this stops
// compiling.
const searchable: SearchableItem = entry;

describe("an index entry is searchable", () => {
  it("carries the fields the search needs", () => {
    expect(searchable.name).toBe("report.pdf");
    expect(searchable.mimeType).toBe("application/pdf");
  });

  it("can be searched with the shared evaluator", () => {
    expect(matchesListQuery(searchable, { status: "active", q: "report" })).toBe(true);
    expect(matchesListQuery(searchable, { status: "active", q: "invoice" })).toBe(false);
  });

  it("survives a round trip through the container unchanged", () => {
    const urk = generateUrk();
    const opened = openIndexContainer(urk, createIndexContainer(urk, [entry]));
    expect(opened[0]).toEqual(entry);
    expect(matchesListQuery(opened[0]!, { status: "active", type: "pdf" })).toBe(true);
  });
});
import {
  entryToFileDTO,
  realNameOf,
  setNameIndex,
  withRealName,
} from "../src/lib/name-index-session";
import { filterByListQuery } from "@omnicloud/shared";

const fileDto = (overrides: Record<string, unknown> = {}) => ({
  id: "file-1",
  name: "om_0123456789abcdef0123456789abcdef",
  size: 1024,
  mimeType: "application/octet-stream",
  sha256: "a",
  folderId: null,
  starred: false,
  trashed: false,
  deletedAt: null,
  versionCount: 1,
  currentVersionId: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
  encryptionFormat: "OCE2",
  ...overrides,
});

describe("the real name of a file", () => {
  it("comes from the index for an OCE2 file", () => {
    const index = new Map([["file-1", { ...entry, id: "file-1", name: "report.pdf" }]]);
    expect(realNameOf(fileDto(), index)).toBe("report.pdf");
  });

  it("is the server's name for an OCE1 file", () => {
    const index = new Map([["file-1", { ...entry, id: "file-1", name: "report.pdf" }]]);
    const oce1 = fileDto({ encryptionFormat: "OCE1", name: "report.pdf" });
    expect(realNameOf(oce1, index)).toBe("report.pdf");
  });

  it("falls back to the placeholder when the index has no entry", () => {
    expect(realNameOf(fileDto(), new Map())).toBe("om_0123456789abcdef0123456789abcdef");
  });

  it("replaces the name in a file record", () => {
    const index = new Map([["file-1", { ...entry, id: "file-1", name: "report.pdf" }]]);
    expect(withRealName(fileDto(), index).name).toBe("report.pdf");
  });
});

describe("searching the index locally", () => {
  const index = new Map([
    [
      "file-1",
      {
        ...entry,
        id: "file-1",
        name: "report.pdf",
        mimeType: "application/pdf",
        trashed: false,
      },
    ],
    [
      "file-2",
      {
        ...entry,
        id: "file-2",
        name: "holiday.png",
        mimeType: "image/png",
        size: 2048,
        trashed: false,
      },
    ],
  ]);

  it("finds a file by its real name", () => {
    const matches = filterByListQuery([...index.values()], { status: "active", q: "report" });
    expect(matches.map((m) => m.id)).toEqual(["file-1"]);
  });

  it("finds a file by its type", () => {
    const matches = filterByListQuery([...index.values()], { status: "active", type: "image" });
    expect(matches.map((m) => m.id)).toEqual(["file-2"]);
  });

  it("turns an entry into a file record for a result row", () => {
    const dto = entryToFileDTO(index.get("file-1")!);
    expect(dto.name).toBe("report.pdf");
    expect(dto.mimeType).toBe("application/pdf");
    expect(dto.size).toBe(2097152);
  });
});

describe("the name index session", () => {
  it("is empty until something is put in it", () => {
    setNameIndex(new Map());
    expect(realNameOf(fileDto())).toBe("om_0123456789abcdef0123456789abcdef");
  });
});
