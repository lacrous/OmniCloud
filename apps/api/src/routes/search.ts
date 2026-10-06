import type { FastifyInstance } from "fastify";
import type { Container } from "../container";
import { toFileDTO, toFolderDTO } from "../mappers";
import { ValidationError } from "@omnicloud/core";

export function registerSearchRoutes(app: FastifyInstance, container: Container): void {
  app.get("/api/search", async (request) => {
    const query = request.query as { q?: string };
    if (!query.q || query.q.trim() === "") {
      throw new ValidationError('Query parameter "q" is required');
    }
    const result = await container.search.search(request.user.id, query.q);
    return {
      files: result.files.map(toFileDTO),
      folders: result.folders.map(toFolderDTO),
    };
  });
}
