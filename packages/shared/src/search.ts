import { fileExtension, mimeMatchersForType } from "./mime";
import type { ListQuery } from "./query";

/**
 * Local search over a client-held index.
 *
 * The evaluator mirrors the server's filters exactly, so a query means the
 * same thing whether it is answered by the server (for files whose names the
 * server still knows) or locally (for files whose names it does not).
 */

/** The fields a search needs. Satisfied by a crypto index entry. */
export interface SearchableItem {
  /** The server's file id, so a result can be fetched. */
  id: string;
  name: string;
  mimeType: string | null;
  size: number;
  folderId: string | null;
  starred: boolean;
  trashed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SearchOptions {
  /** Folder ids a `folder:` filter resolved to, when the caller resolved one. */
  folderIds?: readonly string[] | null;
}

/** True when a MIME type matches a matcher: a prefix matcher or an exact one. */
function matchesMime(mimeType: string | null, matcher: string): boolean {
  if (mimeType === null) return false;
  return matcher.endsWith("/") ? mimeType.startsWith(matcher) : mimeType === matcher;
}

/**
 * True when an item satisfies the query.
 *
 * The rules are the ones the repository layer applies, so an index searched
 * locally and a listing searched by the server return the same things.
 */
export function matchesListQuery(
  item: SearchableItem,
  query: ListQuery,
  options: SearchOptions = {},
): boolean {
  // Status. The API defaults to active, so an unspecified status is active too.
  if (query.status === "trashed") {
    if (!item.trashed) return false;
  } else if (query.status === "all") {
    // Both states are acceptable.
  } else if (item.trashed) {
    return false;
  }

  if (query.starred !== undefined && item.starred !== query.starred) return false;

  // Folder. A null folderId means the root; undefined means any folder.
  if (options.folderIds !== undefined && options.folderIds !== null) {
    if (item.folderId === null || !options.folderIds.includes(item.folderId)) return false;
  } else if (query.folderId !== undefined && item.folderId !== query.folderId) {
    return false;
  }

  // Name substring, case-insensitive, as the repository's "contains" does.
  if (query.q !== undefined && query.q.trim() !== "") {
    if (!item.name.toLowerCase().includes(query.q.trim().toLowerCase())) return false;
  }

  // Extension: a case-insensitive suffix match on the name.
  if (query.ext !== undefined && query.ext !== "") {
    const wanted = query.ext.replace(/^\./, "").toLowerCase();
    if (fileExtension(item.name) !== wanted) return false;
  }

  // Type: a coarse category or an exact MIME type.
  if (query.type !== undefined && query.type !== "") {
    const matchers = mimeMatchersForType(query.type);
    if (matchers === null) return false;
    if (!matchers.some((matcher) => matchesMime(item.mimeType, matcher))) return false;
  }

  if (query.minSize !== undefined && item.size < query.minSize) return false;
  if (query.maxSize !== undefined && item.size > query.maxSize) return false;

  // Date bounds, against the created date, as the repository does.
  if (query.from !== undefined && query.from !== "") {
    const from = new Date(query.from);
    if (!Number.isNaN(from.getTime()) && new Date(item.createdAt).getTime() < from.getTime()) {
      return false;
    }
  }
  if (query.to !== undefined && query.to !== "") {
    const to = new Date(query.to);
    if (!Number.isNaN(to.getTime()) && new Date(item.createdAt).getTime() > to.getTime()) {
      return false;
    }
  }

  return true;
}

/** The items that satisfy the query, in the order they were given. */
export function filterByListQuery<T extends SearchableItem>(
  items: readonly T[],
  query: ListQuery,
  options: SearchOptions = {},
): T[] {
  return items.filter((item) => matchesListQuery(item, query, options));
}
