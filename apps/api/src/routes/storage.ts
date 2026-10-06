import type { FastifyInstance } from "fastify";
import type { Container } from "../container";
import { toStorageDTO } from "../mappers";

/**
 * Storage initialization endpoint — creates the user's private Telegram
 * storage channel if it does not exist yet (idempotent).
 */
export function registerStorageRoutes(app: FastifyInstance, container: Container): void {
  app.post("/api/storage/ensure", async (request) => {
    const storage = await container.connection.ensureStorage(request.user.id);
    return { storage: toStorageDTO(storage) };
  });
}
