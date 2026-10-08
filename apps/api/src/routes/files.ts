import type { FastifyInstance } from "fastify";
import { PayloadTooLargeError, ValidationError } from "@omnicloud/core";
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
import { BATCH_FILE_OPERATIONS, type BatchFileOperation } from "@omnicloud/shared";

function folderIdFromFields(fields: MultipartFields): string | null {
  const field = fields["folderId"];
  if (!field || Array.isArray(field) || field.type !== "field") return null;
  const value = field.value;
  return typeof value === "string" && value !== "" ? value : null;
}

/** Reads a multipart upload into a Buffer, enforcing the configured cap. */
async function readUpload(part: MultipartFile, maxUploadBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  const tooLarge = () =>
    new PayloadTooLargeError(
      `Files larger than ${Math.floor(maxUploadBytes / (1024 * 1024))} MB are not supported`,
    );
  for await (const chunk of part.file) {
    size += chunk.length;
    if (size > maxUploadBytes) throw tooLarge();
    chunks.push(chunk);
  }
  if (part.file.truncated) throw tooLarge();
  return Buffer.concat(chunks);
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
    const data = await readUpload(part, maxUploadBytes);

    const record = await container.files.upload(request.user.id, {
      folderId,
      name: part.filename,
      data,
    });
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

    const result = await container.files.batch(request.user.id, ids, operation, {
      folderId: folderId ?? null,
    });
    return {
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

  // ── Replace (upload a new version) ────────────────────────────────────────
  app.post("/api/files/:id/replace", async (request, reply) => {
    const { id } = request.params as { id: string };
    const part = await request.file();
    if (!part) throw new ValidationError('A multipart body with a "file" field is required');
    if (!part.filename) throw new ValidationError("The uploaded file has no filename");

    const data = await readUpload(part, maxUploadBytes);
    const record = await container.files.upload(request.user.id, {
      folderId: null,
      name: part.filename,
      data,
      replaceFileId: id,
    });
    return reply.send({ file: toFileDTO(record) });
  });

  // ── Download ──────────────────────────────────────────────────────────────
  app.get("/api/files/:id/download", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { record, data, integrityVerified } = await container.files.download(request.user.id, id);
    if (!integrityVerified) {
      request.log.warn({ fileId: record.id }, "SHA-256 integrity mismatch on download");
    }

    const asciiName = record.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    reply
      .header("Content-Type", record.mimeType)
      .header("Content-Length", data.byteLength)
      .header("X-Content-SHA256", record.sha256)
      .header("X-Integrity-Verified", integrityVerified ? "true" : "false")
      .header(
        "Content-Disposition",
        `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(record.name)}`,
      );
    return reply.send(data);
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
