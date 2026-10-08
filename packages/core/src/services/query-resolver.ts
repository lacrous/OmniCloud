import { mimeMatchersForType, paginationMeta } from "@omnicloud/shared";
import type { ListQuery, PaginationDTO } from "@omnicloud/shared";
import type { FolderRepository } from "../repos";
import type { ItemQuery } from "../types";

/**
 * Translates the shared, user-facing ListQuery into the repository-ready
 * ItemQuery: validates/normalizes sort and date bounds, expands MIME
 * categories, and resolves `folder:Name` filters to concrete folder ids.
 */
export async function resolveItemQuery(
  folders: FolderRepository,
  userId: string,
  input: ListQuery,
): Promise<ItemQuery> {
  const query: ItemQuery = {};

  // `folderId: null` means root; `undefined` means "any folder". Distinguish
  // them by presence of a defined value rather than the key itself.
  if (input.folderId !== undefined) query.folderId = input.folderId;
  if (input.q && input.q.trim()) query.nameContains = input.q.trim();
  if (input.ext) query.ext = input.ext.replace(/^\./, "").toLowerCase();
  if (input.starred !== undefined) query.starred = input.starred;
  if (input.minSize !== undefined) query.minSize = input.minSize;
  if (input.maxSize !== undefined) query.maxSize = input.maxSize;
  if (input.sort) query.sort = input.sort;
  if (input.order) query.order = input.order;

  switch (input.status) {
    case "active":
      query.trashed = false;
      break;
    case "trashed":
      query.trashed = true;
      break;
    default:
      query.trashed = undefined;
      break;
  }

  if (input.type) {
    const matchers = mimeMatchersForType(input.type);
    if (matchers) query.mimeMatchers = matchers;
  }

  if (input.from) {
    const from = new Date(input.from);
    if (!Number.isNaN(from.getTime())) query.from = from;
  }
  if (input.to) {
    const to = new Date(input.to);
    if (!Number.isNaN(to.getTime())) query.to = to;
  }

  if (input.folderName) {
    query.folderIds = await folders.findIdsByName(userId, input.folderName);
  }

  return query;
}

/** Builds the pagination envelope shared by every listing endpoint. */
export function toPagination(page: number, limit: number, total: number): PaginationDTO {
  return paginationMeta(page, limit, total);
}

export { paginationMeta };
