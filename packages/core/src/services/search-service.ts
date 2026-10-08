import { paginationMeta, parseSearchQuery } from "@omnicloud/shared";
import type { ListQuery, PaginationDTO, SearchResultDTO } from "@omnicloud/shared";
import { ValidationError } from "../errors";
import type { FileRecord, FolderRecord, PageRequest } from "../types";
import type { FileRepository, FolderRepository } from "../repos";
import { resolveItemQuery } from "./query-resolver";

const MAX_QUERY_LENGTH = 200;

export interface SearchResult {
  files: FileRecord[];
  folders: FolderRecord[];
  pagination: PaginationDTO;
}

/**
 * PostgreSQL-backed search (no Elasticsearch, per the v0.2 scope).
 *
 * The user query is parsed into structured filters (`type:`, `size:`,
 * `folder:`, …) and evaluated by the repository layer, so results respect
 * ownership and stay safely parameterized.
 */
export class SearchService {
  constructor(
    private readonly files: FileRepository,
    private readonly folders: FolderRepository,
  ) {}

  async search(
    userId: string,
    rawQuery: string,
    page: PageRequest,
    overrides: ListQuery = {},
  ): Promise<SearchResult> {
    const trimmed = rawQuery.trim();
    if (!trimmed) throw new ValidationError("Search query must not be empty");
    if (trimmed.length > MAX_QUERY_LENGTH) {
      throw new ValidationError(`Search query must be at most ${MAX_QUERY_LENGTH} characters`);
    }

    const { query } = parseSearchQuery(trimmed, overrides);
    // Search covers both active and trashed items unless the caller narrows it.
    if (query.status === undefined) query.status = "all";

    const itemQuery = await resolveItemQuery(this.folders, userId, query);

    const [filePage, folderPage] = await Promise.all([
      this.files.query(userId, itemQuery, page),
      this.folders.query(userId, itemQuery, page),
    ]);

    // The pagination envelope describes the combined result count so the UI
    // can render a single "load more" affordance.
    const total = filePage.total + folderPage.total;
    return {
      files: filePage.items,
      folders: folderPage.items,
      pagination: paginationMeta(page.page, page.limit, total),
    };
  }

  /** Convenience wrapper returning the shared DTO shape. */
  async searchDTO(
    userId: string,
    rawQuery: string,
    page: PageRequest,
  ): Promise<Omit<SearchResultDTO, "files" | "folders"> & SearchResult> {
    return this.search(userId, rawQuery, page);
  }
}
