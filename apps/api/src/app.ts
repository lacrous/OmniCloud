import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { DomainError, PayloadTooLargeError } from "@omnicloud/core";
import type { Container } from "./container";
import { registerAuthHook } from "./auth";
import { registerAuthRoutes } from "./routes/auth";
import { registerFileRoutes } from "./routes/files";
import { registerFolderRoutes } from "./routes/folders";
import { registerSearchRoutes } from "./routes/search";
import { registerStorageRoutes } from "./routes/storage";

function sendError(
  reply: { status(code: number): { send(body: unknown): unknown } },
  status: number,
  code: string,
  message: string,
  details?: unknown,
): void {
  void reply.status(status).send({ error: { code, message, ...(details ? { details } : {}) } });
}

/** Builds the configured Fastify server. */
export async function createApp(container: Container): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: container.config.logLevel },
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(jwt, { secret: container.config.sessionSecret });
  await app.register(multipart, {
    limits: { fileSize: container.config.maxUploadBytes, files: 1, parts: 5 },
  });

  registerAuthHook(app, container.repos);

  // ── Structured error responses ────────────────────────────────────────────
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof DomainError) {
      sendError(reply, error.status, error.code, error.message, error.details);
      return reply;
    }

    const code = (error as { code?: string }).code ?? "";
    if (code === "FST_PART_FILE_TOO_LARGE" || code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      sendError(reply, 413, "PAYLOAD_TOO_LARGE", "The uploaded file is too large");
      return reply;
    }
    if (typeof error.statusCode === "number") {
      // JSON parse errors and other framework errors.
      sendError(reply, error.statusCode, "VALIDATION_ERROR", error.message);
      return reply;
    }

    request.log.error({ err: error }, "Unhandled error");
    sendError(reply, 500, "INTERNAL_ERROR", "Internal server error");
    return reply;
  });

  // ── API routes ────────────────────────────────────────────────────────────
  registerAuthRoutes(app, container);
  registerFileRoutes(app, container);
  registerFolderRoutes(app, container);
  registerSearchRoutes(app, container);
  registerStorageRoutes(app, container);

  // ── Serve the built web application (single-port deployments) ─────────────
  const webDistDir = container.config.webDistDir;
  if (webDistDir && existsSync(webDistDir)) {
    await app.register(fastifyStatic, { root: resolve(webDistDir), wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/")) {
        return reply.sendFile("index.html");
      }
      sendError(reply, 404, "NOT_FOUND", "Not found");
      return reply;
    });
  } else {
    app.setNotFoundHandler((request, reply) => {
      sendError(reply, 404, "NOT_FOUND", "Not found");
      return reply;
    });
  }

  return app;
}

export { PayloadTooLargeError };
