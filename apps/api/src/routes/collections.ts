import type { FastifyInstance } from "fastify";
import { ValidationError } from "@omnicloud/core";
import type { Container } from "../container";
import { parseListQuery } from "../validation";
import { toActivityDTO, toFileDTO, toFolderDTO } from "../mappers";

/**
 * Collection views shared by the Drive UI: Trash, Starred, Recent,
 * Search and the activity feed.
 */
export function registerCollectionRoutes(app: FastifyInstance, container: Container): void {
  // ── Trash ─────────────────────────────────────────────────────────────────
  app.get("/api/trash", async (request) => {
    const raw = request.query as Record<string, unknown>;
    const { query, page, limit } = parseListQuery(raw);
    const listing = await container.trash.list(request.user.id, { page, limit }, query);
    return {
      files: listing.files.map(toFileDTO),
      folders: listing.folders.map(toFolderDTO),
      pagination: listing.pagination,
    };
  });

  app.post("/api/trash/empty", async (request) => {
    const result = await container.trash.empty(request.user.id);
    return {
      deletedFiles: result.deletedFiles,
      deletedFolders: result.deletedFolders,
      failedFiles: result.failedFiles,
    };
  });

  // ── Starred ───────────────────────────────────────────────────────────────
  app.get("/api/starred", async (request) => {
    const raw = request.query as Record<string, unknown>;
    const { query, page, limit } = parseListQuery(raw);
    const merged = { ...query, starred: true, folderId: undefined };

    const [fileResult, folderResult] = await Promise.all([
      container.files.query(request.user.id, merged, { page, limit }),
      container.folders.query(request.user.id, merged, { page, limit }),
    ]);

    const total = fileResult.total + folderResult.total;
    return {
      files: fileResult.items.map(toFileDTO),
      folders: folderResult.items.map(toFolderDTO),
      pagination: { page, limit, total, hasMore: page * limit < total },
    };
  });

  // ── Recent ────────────────────────────────────────────────────────────────
  app.get("/api/recent", async (request) => {
    const { page, limit } = parseListQuery(request.query as Record<string, unknown>);
    return container.recent.list(request.user.id, { page, limit });
  });

  // ── Search ────────────────────────────────────────────────────────────────
  app.get("/api/search", async (request) => {
    const raw = request.query as Record<string, unknown>;
    const query = typeof raw.q === "string" ? raw.q : "";
    if (query.trim() === "") {
      throw new ValidationError('Query parameter "q" is required');
    }
    const { page, limit } = parseListQuery(raw);
    const result = await container.search.search(request.user.id, query, { page, limit });
    return {
      files: result.files.map(toFileDTO),
      folders: result.folders.map(toFolderDTO),
      pagination: result.pagination,
    };
  });

  // ── Activity feed ─────────────────────────────────────────────────────────
  app.get("/api/activity", async (request) => {
    const { page, limit } = parseListQuery(request.query as Record<string, unknown>);
    const result = await container.activity.list(request.user.id, { page, limit });
    return {
      events: result.items.map(toActivityDTO),
      pagination: { page, limit, total: result.total, hasMore: page * limit < result.total },
    };
  });
}
