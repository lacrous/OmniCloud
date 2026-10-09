import { describe, expect, it } from "vitest";
import { deepestFirst } from "../src/utils/folder-order";
import type { FolderRecord } from "../src/types";

function folder(id: string, parentId: string | null): FolderRecord {
  return {
    id,
    userId: "u",
    parentId,
    name: id,
    starred: false,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as FolderRecord;
}

describe("deepestFirst", () => {
  it("orders a three-level chain leaf-first, so no parent is removed before its child", () => {
    const folders = [folder("root", null), folder("mid", "root"), folder("leaf", "mid")];
    expect(deepestFirst(["root", "mid", "leaf"], folders)).toEqual(["leaf", "mid", "root"]);
  });

  it("keeps siblings and unrelated branches valid", () => {
    const folders = [
      folder("a", null),
      folder("a1", "a"),
      folder("a1x", "a1"),
      folder("b", null),
      folder("b1", "b"),
    ];
    const ordered = deepestFirst(["a", "a1", "a1x", "b", "b1"], folders);
    for (const id of ordered) {
      const children = folders.filter((f) => f.parentId === id).map((f) => f.id);
      for (const child of children) {
        expect(ordered.indexOf(child)).toBeLessThan(ordered.indexOf(id));
      }
    }
  });

  it("does not loop on a corrupted parent cycle", () => {
    const folders = [folder("x", "y"), folder("y", "x")];
    expect(deepestFirst(["x", "y"], folders)).toHaveLength(2);
  });
});
