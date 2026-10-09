import type { FastifyInstance } from "fastify";
import {
  PayloadTooLargeError,
  ValidationError,
  isValidOperationId,
  spoolToFile,
} from "@omnicloud/core";
import type { MultipartFields, MultipartFile } from "@fastify/multipart";
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
import { toFileDTO, toVersionDTO } from "../mappers";
import { parseRetentionPolicy } from "../validation";
import { BATCH_FILE_OPERATIONS, type BatchFileOperation } from "@omnicloud/shared";

/** Client-supplied idempotency key: the Idempotency-Key header, or an operationId field. */
function operationIdFrom(
  headers: Record<string, unknown>,
  fields: MultipartFields,
): string | undefined {
  const header = headers["idempotency-key"];
  if (typeof header === "string" && header !== "") return header;
  const field = fields["operationId"];
  if (field && !Array.isArray(field) && field.type === "field" && typeof field.value === "string") {
    return field.value || undefined;
  }
  return undefined;
}

function folderIdFromFields(fields: MultipartFields): string | null {
  const field = fields["folderId"];
  if (!field || Array.isArray(field) || field.type !== "field") return null;
  const value = field.value;
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Streams a multipart file to disk, enforcing the cap, and hands its spooled
 * copy to `use`. The spool is removed whether `use` succeeds or fails, so a
 * rejected or failed upload never leaves bytes behind.
 */
async function withSpooledUpload<T>(
  part: MultipartFile,
  maxUploadBytes: number,
  use: (spooled: { path: string; size: number; sha256: string }) => Promise<T>,
): Promise<T> {
  const spool = await spoolToFile(part.file, maxUploadBytes);
  try {
    if (part.file.truncated) {
      throw new PayloadTooLargeError(
        `Files larger than ${Math.floor(maxUploadBytes / (1024 * 1024))} MB are not supported`,
      );
    }
    return await use({ path: spool.path, size: spool.size, sha256: spool.sha256 });
  } finally {
    await spool.discard();
  }
}

/**
 * File endpoints: upload, list/query, metadata, versions, download, replace,
 * rename/star, move, trash/restore, permanent delete and batch operations.
 */
export function registerFileRoutes(app: FastifyInstance, container: Container): void {
  const maxUploadBytes = container.config.maxUploadBytes;

  // ── Upload ────────────────────────────────────────────────────────────────
  app.post("/api/files", async (request, reply) => {
    const part = await request.file();
    if (!part) throw new ValidationError('A multipart body with a "file" field is required');
    if (!part.filename) throw new ValidationError("The uploaded file has no filename");

    const folderId = folderIdFromFields(part.fields);
    const operationId = operationIdFrom(request.headers, part.fields);
    const record = await withSpooledUpload(part, maxUploadBytes, (spooled) =>
      container.files.upload(request.user.id, {
        folderId,
        name: part.filename,
        spooled,
        operationId,
      }),
    );
    return reply.status(201).send({ file: toFileDTO(record) });
  });

  // ── List / query ──────────────────────────────────────────────────────────
  app.get("/api/files", async (request) => {
    const { query, page, limit } = parseListQuery(request.query as Record<string, unknown>);
    const result = await container.files.query(request.user.id, query, { page, limit });
    return {
      files: result.items.map(toFileDTO),
      pagination: { page, limit, total: result.total, hasMore: page * limit < result.total },
    };
  });

  // ── Batch operations (before /:id routes so "batch" isn't read as an id) ──
  app.post("/api/files/batch", async (request) => {
    const body = requireBody(request);
    const operation = requireEnum<BatchFileOperation>(body, "operation", BATCH_FILE_OPERATIONS);
    const ids = requireStringArray(body, "ids");
    const folderId = operation === "move" ? stringOrNull(body, "folderId") : undefined;

    const operationId = stringOrNull(body, "operationId") ?? undefined;
    if (operationId !== undefined && !isValidOperationId(operationId)) {
      throw new ValidationError("Invalid batch operation id");
    }

    const result = await container.files.batch(request.user.id, ids, operation, {
      folderId: folderId ?? null,
      operationId,
    });
    return {
      ...(result.operationId ? { operationId: result.operationId } : {}),
      requested: result.requested,
      succeeded: result.succeeded,
      failed: result.failed,
      errors: result.errors.map((error) => ({
        id: error.id,
        code: "INVALID_REQUEST" as const,
        message: error.message,
      })),
    };
  });

  // ── Metadata ──────────────────────────────────────────────────────────────
  app.get("/api/files/:id", async (request) => {
    const { id } = request.params as { id: string };
    const record = await container.files.get(request.user.id, id);
    return { file: toFileDTO(record) };
  });

  app.get("/api/files/:id/versions", async (request) => {
    const { id } = request.params as { id: string };
    const record = await container.files.get(request.user.id, id);
    const versions = await container.files.listVersions(request.user.id, id);
    return { versions: versions.map((v) => toVersionDTO(v, record.currentVersionId)) };
  });

  // ── Prune old versions (explicit, per-file; never runs on its own) ───────
  app.post("/api/files/:id/versions/prune", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = requireBody(request);
    const policy = parseRetentionPolicy(body);
    const removed = await container.files.pruneVersions(request.user.id, id, policy);
    return reply.send({ removed });
  });

  // ── Replace (upload a new version) ────────────────────────────────────────
  app.post("/api/files/:id/replace", async (request, reply) => {
    const { id } = request.params as { id: string };
    const part = await request.file();
    if (!part) throw new ValidationError('A multipart body with a "file" field is required');
    if (!part.filename) throw new ValidationError("The uploaded file has no filename");

    const record = await withSpooledUpload(part, maxUploadBytes, (spooled) =>
      container.files.upload(request.user.id, {
        folderId: null,
        name: part.filename,
        spooled,
        replaceFileId: id,
      }),
    );
    return reply.send({ file: toFileDTO(record) });
  });

  // ── Download ──────────────────────────────────────────────────────────────
  // Streams the object straight from Telegram to the client. The stream is
  // verified against the stored SHA-256 before its final bytes are released,
  // so a corrupt object fails the transfer rather than completing with bad data.
  app.get("/api/files/:id/download", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { record, stream } = await container.files.downloadStreamed(request.user.id, id);

    const asciiName = record.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    reply
      .header("Content-Type", record.mimeType)
      .header("Content-Length", record.size)
      .header("X-Content-SHA256", record.sha256)
      .header(
        "Content-Disposition",
        `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(record.name)}`,
      );

    stream.once("error", (error) => {
      request.log.error({ fileId: record.id, err: error }, "download stream failed");
    });
    return reply.send(stream);
  });

  // ── Rename / star ─────────────────────────────────────────────────────────
  app.patch("/api/files/:id", async (request) => {
    const { id } = request.params as { id: string };
    const body = requireBody(request);

    const name = optionalString(body, "name");
    const starred = optionalBoolean(body, "starred");
    if (name === undefined && starred === undefined) {
      throw new ValidationError('At least one of "name" or "starred" is required');
    }

    let record = await container.files.get(request.user.id, id);
    if (name !== undefined) record = await container.files.rename(request.user.id, id, name);
    if (starred !== undefined)
      record = await container.files.setStarred(request.user.id, id, starred);
    return { file: toFileDTO(record) };
  });

  // ── Move ──────────────────────────────────────────────────────────────────
  app.post("/api/files/:id/move", async (request) => {
    const { id } = request.params as { id: string };
    const body = requireBody(request);
    const folderId = stringOrNull(body, "folderId");
    const record = await container.files.move(request.user.id, id, folderId);
    return { file: toFileDTO(record) };
  });

  // ── Trash / restore / permanent delete ────────────────────────────────────
  app.post("/api/files/:id/trash", async (request) => {
    const { id } = request.params as { id: string };
    const record = await container.files.trash(request.user.id, id);
    return { file: toFileDTO(record) };
  });

  app.post("/api/files/:id/restore", async (request) => {
    const { id } = request.params as { id: string };
    const record = await container.files.restore(request.user.id, id);
    return { file: toFileDTO(record) };
  });

  app.delete("/api/files/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await container.files.deletePermanently(request.user.id, id);
    return reply.status(204).send();
  });
}
