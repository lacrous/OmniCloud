import type { FastifyInstance } from "fastify";
import { PayloadTooLargeError, ValidationError } from "@omnicloud/core";
import type { MultipartFields } from "@fastify/multipart";
import type { Container } from "../container";
import { requireBody, stringOrNull, optionalString } from "../validation";
import { toFileDTO } from "../mappers";

function folderIdFromFields(fields: MultipartFields): string | null {
  const field = fields["folderId"];
  if (!field || Array.isArray(field) || field.type !== "field") return null;
  const value = field.value;
  return typeof value === "string" && value !== "" ? value : null;
}

/** File endpoints: upload, list, metadata, download, rename, move, delete. */
export function registerFileRoutes(app: FastifyInstance, container: Container): void {
  const maxUploadBytes = container.config.maxUploadBytes;
  const maxUploadMb = Math.floor(maxUploadBytes / (1024 * 1024));

  // ── Upload ────────────────────────────────────────────────────────────────
  app.post("/api/files", async (request, reply) => {
    const part = await request.file();
    if (!part) {
      throw new ValidationError('A multipart body with a "file" field is required');
    }
    if (!part.filename) {
      throw new ValidationError("The uploaded file has no filename");
    }

    const folderId = folderIdFromFields(part.fields);

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of part.file) {
      size += chunk.length;
      if (size > maxUploadBytes) {
        reply.header("connection", "close");
        throw new PayloadTooLargeError(
          `Files larger than ${maxUploadMb} MB are not supported in v0.1`,
        );
      }
      chunks.push(chunk);
    }
    if (part.file.truncated) {
      throw new PayloadTooLargeError(
        `Files larger than ${maxUploadMb} MB are not supported in v0.1`,
      );
    }
    const data = Buffer.concat(chunks);

    const record = await container.files.upload(request.user.id, {
      folderId,
      name: part.filename,
      data,
    });

    return reply.status(201).send({ file: toFileDTO(record) });
  });

  // ── List files in a folder (root when folderId is absent) ────────────────
  app.get("/api/files", async (request) => {
    const query = request.query as { folderId?: string };
    const folderId = query.folderId && query.folderId !== "" ? query.folderId : null;
    const files = await container.files.list(request.user.id, folderId);
    return { files: files.map(toFileDTO) };
  });

  // ── File metadata ─────────────────────────────────────────────────────────
  app.get("/api/files/:id", async (request) => {
    const { id } = request.params as { id: string };
    const record = await container.files.get(request.user.id, id);
    return { file: toFileDTO(record) };
  });

  // ── Download (integrity is verified against the stored SHA-256) ──────────
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

  // ── Rename ────────────────────────────────────────────────────────────────
  app.patch("/api/files/:id", async (request) => {
    const { id } = request.params as { id: string };
    const body = requireBody(request);
    const name = optionalString(body, "name");
    if (name === undefined) {
      throw new ValidationError('Field "name" is required');
    }
    const record = await container.files.rename(request.user.id, id, name);
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

  // ── Delete ────────────────────────────────────────────────────────────────
  app.delete("/api/files/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await container.files.delete(request.user.id, id);
    return reply.status(204).send();
  });
}
