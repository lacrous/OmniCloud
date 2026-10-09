import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildContentSecurityPolicy, inlineBlocks } from "./csp";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { DomainError, ForbiddenError, PayloadTooLargeError } from "@omnicloud/core";
import type { ErrorCode } from "@omnicloud/shared";
import type { Container } from "./container";
import { registerAuthHook } from "./auth";
import { LOGGER_OPTIONS } from "./logging";
import { applySecurityHeaders, attachRequestId, isAllowedOrigin, resolveRequestId } from "./http";
import { registerAuthRoutes } from "./routes/auth";
import { registerFileRoutes } from "./routes/files";
import { registerFolderRoutes } from "./routes/folders";
import { registerCollectionRoutes } from "./routes/collections";
import { registerStorageRoutes } from "./routes/storage";

interface ErrorReply {
  status(code: number): { send(body: unknown): unknown };
}

function sendError(
  reply: ErrorReply,
  status: number,
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: unknown,
): void {
  void reply
    .status(status)
    .send({ error: { code, message, requestId, ...(details ? { details } : {}) } });
}

/** Builds the configured Fastify server. */
export async function createApp(container: Container): Promise<FastifyInstance> {
  const app = Fastify({
    logger: LOGGER_OPTIONS(container.config.logLevel),
    // JSON request bodies are tiny; uploads go through multipart, not bodyLimit.
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: container.config.trustProxy,
    genReqId: (request) => resolveRequestId(request.headers),
  });

  await app.register(cookie);
  await app.register(multipart, {
    limits: { fileSize: container.config.maxUploadBytes, files: 1, parts: 10 },
  });

  // ── Request id + security headers + CSRF origin check ────────────────────
  app.addHook("onRequest", async (request, reply) => {
    attachRequestId(request, reply);
    applySecurityHeaders(reply);
  });

  app.addHook("preHandler", async (request) => {
    // State-changing requests must come from an allowed origin (CSRF defense
    // in depth on top of SameSite=Lax cookies). Non-browser clients send no
    // Origin header and are permitted.
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      const origin = request.headers.origin;
      const host = request.headers.host;
      if (!isAllowedOrigin(origin, host, container.config.allowedOrigins)) {
        throw new ForbiddenError("Cross-origin request rejected");
      }
    }
  });

  registerAuthHook(app, container.repos, container.authSessions);

  // ── Structured error responses ────────────────────────────────────────────
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof DomainError) {
      sendError(reply, error.status, error.code, error.message, request.id, error.details);
      return reply;
    }

    const code = (error as { code?: string }).code ?? "";
    if (code === "FST_PART_FILE_TOO_LARGE" || code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      sendError(reply, 413, "PAYLOAD_TOO_LARGE", "The uploaded file is too large", request.id);
      return reply;
    }
    if (code === "FST_REQ_FILE_TOO_LARGE") {
      sendError(reply, 413, "PAYLOAD_TOO_LARGE", "The uploaded file is too large", request.id);
      return reply;
    }
    if (typeof error.statusCode === "number") {
      sendError(reply, error.statusCode, "INVALID_REQUEST", error.message, request.id);
      return reply;
    }

    request.log.error({ err: error, requestId: request.id }, "Unhandled error");
    sendError(reply, 500, "INTERNAL_ERROR", "Internal server error", request.id);
    return reply;
  });

  // ── API routes ────────────────────────────────────────────────────────────
  registerAuthRoutes(app, container);
  registerFileRoutes(app, container);
  registerFolderRoutes(app, container);
  registerCollectionRoutes(app, container);
  registerStorageRoutes(app, container);

  // ── Serve the built web application (single-port deployments) ─────────────
  const webDistDir = container.config.webDistDir;
  if (webDistDir && existsSync(webDistDir)) {
    await app.register(fastifyStatic, { root: resolve(webDistDir), wildcard: false });
    // The policy is derived from the exact bytes of the served page, so it always
    // matches the inline blocks it allows. A page that cannot be read fails startup
    // rather than being served without a policy.
    const indexHtml = readFileSync(join(resolve(webDistDir), "index.html"), "utf8");
    const { scripts, styles } = inlineBlocks(indexHtml);
    const contentSecurityPolicy = buildContentSecurityPolicy(scripts, styles);
    app.addHook("onSend", async (request, reply, payload) => {
      if (request.method === "GET" && !request.url.startsWith("/api/")) {
        reply.header("Content-Security-Policy", contentSecurityPolicy);
      }
      return payload;
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/")) {
        return reply.sendFile("index.html");
      }
      sendError(reply, 404, "NOT_FOUND", "Not found", request.id);
      return reply;
    });
  } else {
    app.setNotFoundHandler((request, reply) => {
      sendError(reply, 404, "NOT_FOUND", "Not found", request.id);
      return reply;
    });
  }

  return app;
}

export { PayloadTooLargeError };
