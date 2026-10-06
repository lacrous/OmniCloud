import type { FastifyInstance } from "fastify";
import type { Container } from "../container";
import { optionalString, requireBody, stringOrNull } from "../validation";
import { toFolderDTO } from "../mappers";
import { ValidationError } from "@omnicloud/core";

/** Folder endpoints: create, list, tree, rename, move, delete (recursive). */
export function registerFolderRoutes(app: FastifyInstance, container: Container): void {
  // ── Create ────────────────────────────────────────────────────────────────
  app.post("/api/folders", async (request, reply) => {
    const body = requireBody(request);
    const name = optionalString(body, "name");
    if (name === undefined) {
      throw new ValidationError('Field "name" is required');
    }
    const parentId = stringOrNull(body, "parentId");
    const record = await container.folders.create(request.user.id, { name, parentId });
    return reply.status(201).send({ folder: toFolderDTO(record) });
  });

  // ── List children of a folder (root when parentId is absent) ─────────────
  app.get("/api/folders", async (request) => {
    const query = request.query as { parentId?: string };
    const parentId = query.parentId && query.parentId !== "" ? query.parentId : null;
    const folders = await container.folders.listChildren(request.user.id, parentId);
    return { folders: folders.map(toFolderDTO) };
  });

  // ── Full folder tree (used by the move dialog) ───────────────────────────
  app.get("/api/folders/tree", async (request) => {
    const folders = await container.folders.tree(request.user.id);
    return { folders: folders.map(toFolderDTO) };
  });

  // ── Rename ────────────────────────────────────────────────────────────────
  app.patch("/api/folders/:id", async (request) => {
    const { id } = request.params as { id: string };
    const body = requireBody(request);
    const name = optionalString(body, "name");
    if (name === undefined) {
      throw new ValidationError('Field "name" is required');
    }
    const record = await container.folders.rename(request.user.id, id, name);
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

  // ── Delete (recursive) ────────────────────────────────────────────────────
  app.delete("/api/folders/:id", async (request) => {
    const { id } = request.params as { id: string };
    const result = await container.folders.delete(request.user.id, id);
    return result;
  });
}
