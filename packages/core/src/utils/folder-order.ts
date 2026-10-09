import type { FolderRecord } from "../types";

/**
 * Orders folder ids so every child comes before its parent. Deleting in this
 * order satisfies the database's `onDelete: Restrict` rule on `parentId`.
 */
export function deepestFirst(folderIds: string[], folders: FolderRecord[]): string[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const depthOf = (id: string): number => {
    let depth = 0;
    const seen = new Set<string>();
    let cursor = byId.get(id)?.parentId ?? null;
    while (cursor !== null && !seen.has(cursor)) {
      seen.add(cursor);
      depth += 1;
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    return depth;
  };
  return [...folderIds].sort((a, b) => depthOf(b) - depthOf(a));
}
