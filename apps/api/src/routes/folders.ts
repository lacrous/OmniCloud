import type { FastifyInstance } from "fastify";
import { ValidationError } from "@omnicloud/core";
import type { Container } from "../container";
import {
  optionalBoolean,
  optionalString,
  parseListQuery,
  requireBody,
  requireEnum,
  requireStringArray,
  stringOrNull,
} from "../validation";
import { toFolderDTO } from "../mappers";
import { BATCH_FOLDER_OPERATIONS, type BatchFolderOperation } from "@omnicloud/shared";

/** Folder endpoints: create, list, tree, rename/star, move, trash/restore, delete, batch. */
export function registerFolderRoutes(app: FastifyInstance, container: Container): void {
  // ── Create ────────────────────────────────────────────────────────────────
  app.post("/api/folders", async (request, reply) => {
    const body = requireBody(request);
    const name = optionalString(body, "name");
    if (name === undefined) throw new ValidationError('Field "name" is required');
    const parentId = stringOrNull(body, "parentId");
    const record = await container.folders.create(request.user.id, { name, parentId });
    return reply.status(201).send({ folder: toFolderDTO(record) });
  });

  // ── List children of a folder (root when parentId is absent) ─────────────
  app.get("/api/folders", async (request) => {
    const raw = request.query as Record<string, unknown>;
    // Default to the root when no scope filter is supplied, matching v0.1.
    if (!("parentId" in raw) && !("status" in raw) && !("q" in raw) && !("starred" in raw)) {
      const folders = await container.folders.listChildren(request.user.id, null);
      return {
        folders: folders.map(toFolderDTO),
        pagination: { page: 1, limit: folders.length, total: folders.length, hasMore: false },
      };
    }

    const { query, page, limit } = parseListQuery(raw);
    if ("parentId" in raw) {
      query.folderId =
        typeof raw.parentId === "string" && raw.parentId !== "" ? raw.parentId : null;
    }
    const result = await container.folders.query(request.user.id, query, { page, limit });
    return {
      folders: result.items.map(toFolderDTO),
      pagination: { page, limit, total: result.total, hasMore: page * limit < result.total },
    };
  });

  // ── Full active tree (used by the move dialog) ───────────────────────────
  app.get("/api/folders/tree", async (request) => {
    const folders = await container.folders.tree(request.user.id);
    return { folders: folders.map(toFolderDTO) };
  });

  // ── Batch operations ──────────────────────────────────────────────────────
  app.post("/api/folders/batch", async (request) => {
    const body = requireBody(request);
    const operation = requireEnum<BatchFolderOperation>(body, "operation", BATCH_FOLDER_OPERATIONS);
    const ids = requireStringArray(body, "ids");
    const parentId = operation === "move" ? stringOrNull(body, "parentId") : undefined;

    let succeeded = 0;
    const errors: { id: string; code: "INVALID_REQUEST"; message: string }[] = [];

    for (const id of ids) {
      try {
        switch (operation) {
          case "trash":
            await container.folders.trash(request.user.id, id);
            break;
          case "restore":
            await container.folders.restore(request.user.id, id);
            break;
          case "delete":
            await container.folders.deletePermanently(request.user.id, id);
            break;
          case "star":
            await container.folders.setStarred(request.user.id, id, true);
            break;
          case "unstar":
            await container.folders.setStarred(request.user.id, id, false);
            break;
          case "move":
            await container.folders.move(request.user.id, id, parentId ?? null);
            break;
        }
        succeeded += 1;
      } catch (error) {
        errors.push({
          id,
          code: "INVALID_REQUEST",
          message: error instanceof Error ? error.message : "Operation failed",
        });
      }
    }

    return { requested: ids.length, succeeded, failed: errors.length, errors };
  });

  // ── Rename / star ─────────────────────────────────────────────────────────
  app.patch("/api/folders/:id", async (request) => {
    const { id } = request.params as { id: string };
    const body = requireBody(request);
    const name = optionalString(body, "name");
    const starred = optionalBoolean(body, "starred");
    if (name === undefined && starred === undefined) {
      throw new ValidationError('At least one of "name" or "starred" is required');
    }

    let record = await container.folders.get(request.user.id, id);
    if (name !== undefined) record = await container.folders.rename(request.user.id, id, name);
    if (starred !== undefined) {
      record = await container.folders.setStarred(request.user.id, id, starred);
    }
    return { folder: toFolderDTO(record) };
  });

  // ── Move ──────────────────────────────────────────────────────────────────
  app.post("/api/folders/:id/move", async (request) => {
    const { id } = request.params as { id: string };
    const body = requireBody(request);
    const parentId = stringOrNull(body, "parentId");
    const record = await container.folders.move(request.user.id, id, parentId);
    return { folder: toFolderDTO(record) };
  });

  // ── Trash / restore / permanent delete ────────────────────────────────────
  app.post("/api/folders/:id/trash", async (request) => {
    const { id } = request.params as { id: string };
    const result = await container.folders.trash(request.user.id, id);
    return { affectedFolders: result.affectedFolders, affectedFiles: result.affectedFiles };
  });

  app.post("/api/folders/:id/restore", async (request) => {
    const { id } = request.params as { id: string };
    const result = await container.folders.restore(request.user.id, id);
    return { affectedFolders: result.affectedFolders, affectedFiles: result.affectedFiles };
  });

  app.delete("/api/folders/:id", async (request) => {
    const { id } = request.params as { id: string };
    const result = await container.folders.deletePermanently(request.user.id, id);
    return { affectedFolders: result.affectedFolders, affectedFiles: result.affectedFiles };
  });
}
