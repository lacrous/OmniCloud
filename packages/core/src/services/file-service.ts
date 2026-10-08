import type { Readable } from "node:stream";
import type { ListQuery } from "@omnicloud/shared";
import { mimeFromFilename } from "@omnicloud/shared";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { sanitizeFileName } from "../utils/filename";
import type { FileRecord, FileVersionRecord, ItemQuery, PageRequest, Paged } from "../types";
import type { FileRepository, FolderRepository } from "../repos";
import type { StorageEngine } from "../storage/engine";
import type { TransferControl, TransferProgress } from "../storage/provider";
import type { ActivityRecorder } from "./activity-service";
import { noopActivityRecorder } from "./activity-service";
import { resolveItemQuery } from "./query-resolver";

export interface FileDownload {
  record: FileRecord;
  data: Buffer;
  integrityVerified: boolean;
}

export interface FileStreamDownload {
  record: FileRecord;
  /** Errors with IntegrityCheckError instead of ending if the bytes do not match. */
  stream: Readable;
}

export type EngineResolver = (userId: string) => Promise<StorageEngine>;

export interface FileUploadInput {
  folderId: string | null;
  name: string;
  /** In-memory content. Use `spooled` for anything large. */
  data?: Buffer;
  /** A file already written to disk by `spoolToFile`, with its checksum. */
  spooled?: { path: string; size: number; sha256: string };
  /** When set, uploads a new version of this file instead of creating one. */
  replaceFileId?: string;
  /** Progress callback forwarded from the transport layer. */
  onProgress?: (progress: TransferProgress) => void;
  signal?: AbortSignal;
}

export interface FileListResult {
  items: FileRecord[];
  total: number;
}

/**
 * File metadata operations. Every method verifies ownership: records
 * belonging to other users are reported as missing.
 *
 * Reliability rules honored here:
 *  - metadata is written only after the storage upload succeeds;
 *  - permanent deletion removes the remote object before the metadata;
 *  - client-supplied ownership is never trusted (userId is server-derived).
 */
export class FileService {
  constructor(
    private readonly files: FileRepository,
    private readonly folders: FolderRepository,
    private readonly engineFor: EngineResolver,
    private readonly activity: ActivityRecorder = noopActivityRecorder,
  ) {}

  // ── Upload ───────────────────────────────────────────────────────────────

  async upload(userId: string, input: FileUploadInput): Promise<FileRecord> {
    const name = sanitizeFileName(input.name);
    if (!name) throw new ValidationError("Invalid file name");

    let folderId = input.folderId;
    if (input.replaceFileId) {
      const existing = await this.get(userId, input.replaceFileId);
      folderId = existing.folderId;
    } else if (folderId !== null) {
      await this.assertFolder(userId, folderId);
    }

    const mimeType = mimeFromFilename(name);
    const engine = await this.engineFor(userId);

    const control: TransferControl = {
      onProgress: input.onProgress,
      signal: input.signal,
    };

    if (!input.data && !input.spooled) {
      throw new ValidationError("An upload needs content");
    }
    // Upload first; metadata is only persisted once the provider succeeds.
    const { stored, sha256, size } = await engine.upload(
      input.spooled
        ? {
            name,
            mimeType,
            path: input.spooled.path,
            size: input.spooled.size,
            sha256: input.spooled.sha256,
          }
        : { name, mimeType, data: input.data },
      control,
    );
    const telegramMessageId = Number(stored.messageId);

    if (input.replaceFileId) {
      return this.replaceVersion(userId, input.replaceFileId, {
        name,
        size,
        mimeType,
        sha256,
        telegramMessageId,
      });
    }

    const record = await this.files.create({
      userId,
      folderId,
      name,
      size,
      mimeType,
      sha256,
      telegramMessageId,
    });

    // Establish version 1 immediately so the version history is complete from
    // the first upload (the foundation for v0.3's version UI).
    const version = await this.files.createVersion({
      fileId: record.id,
      userId,
      size,
      mimeType,
      sha256,
      telegramMessageId,
    });
    const withVersion = await this.files.update(record.id, {
      currentVersionId: version.id,
      versionCount: 1,
    });

    await this.activity.record({
      userId,
      action: "upload",
      resourceType: "file",
      resourceId: withVersion.id,
      resourceName: withVersion.name,
      metadata: { size, mimeType },
    });

    return withVersion;
  }

  /** Uploads a new version of an existing file and makes it current. */
  private async replaceVersion(
    userId: string,
    fileId: string,
    next: {
      name: string;
      size: number;
      mimeType: string;
      sha256: string;
      telegramMessageId: number;
    },
  ): Promise<FileRecord> {
    const existing = await this.get(userId, fileId);

    const version = await this.files.createVersion({
      fileId,
      userId,
      size: next.size,
      mimeType: next.mimeType,
      sha256: next.sha256,
      telegramMessageId: next.telegramMessageId,
    });
    const count = await this.files.countVersions(fileId);

    const updated = await this.files.update(fileId, {
      name: next.name,
      size: next.size,
      mimeType: next.mimeType,
      sha256: next.sha256,
      telegramMessageId: next.telegramMessageId,
      currentVersionId: version.id,
      versionCount: count,
    });

    await this.activity.record({
      userId,
      action: "replace",
      resourceType: "file",
      resourceId: fileId,
      resourceName: updated.name,
      metadata: { previousSha256: existing.sha256, size: next.size },
    });

    return updated;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  async list(userId: string, folderId: string | null): Promise<FileRecord[]> {
    if (folderId !== null) await this.assertFolder(userId, folderId);
    return this.files.listByFolder(userId, folderId);
  }

  async query(userId: string, input: ListQuery, page: PageRequest): Promise<Paged<FileRecord>> {
    if (input.folderId != null) await this.assertFolder(userId, input.folderId);
    const query: ItemQuery = await resolveItemQuery(this.folders, userId, input);
    return this.files.query(userId, query, page);
  }

  async get(userId: string, id: string): Promise<FileRecord> {
    const record = await this.files.findById(id);
    if (!record || record.userId !== userId) throw new NotFoundError("File not found", "file");
    return record;
  }

  /** Like get(), but rejects trashed files (for download/open). */
  async getActive(userId: string, id: string): Promise<FileRecord> {
    const record = await this.get(userId, id);
    if (record.deletedAt) throw new NotFoundError("File not found", "file");
    return record;
  }

  async listVersions(userId: string, id: string): Promise<FileVersionRecord[]> {
    await this.get(userId, id);
    return this.files.listVersions(id);
  }

  // ── Mutations ────────────────────────────────────────────────────────────

  async rename(userId: string, id: string, name: string): Promise<FileRecord> {
    const existing = await this.get(userId, id);
    const clean = sanitizeFileName(name);
    if (!clean) throw new ValidationError("Invalid file name");
    const updated = await this.files.update(id, { name: clean });
    await this.activity.record({
      userId,
      action: "rename",
      resourceType: "file",
      resourceId: id,
      resourceName: clean,
      metadata: { previousName: existing.name },
    });
    return updated;
  }

  async move(userId: string, id: string, folderId: string | null): Promise<FileRecord> {
    const existing = await this.get(userId, id);
    if (folderId !== null) await this.assertFolder(userId, folderId);
    const updated = await this.files.update(id, { folderId });
    await this.activity.record({
      userId,
      action: "move",
      resourceType: "file",
      resourceId: id,
      resourceName: updated.name,
      metadata: { from: existing.folderId, to: folderId },
    });
    return updated;
  }

  async setStarred(userId: string, id: string, starred: boolean): Promise<FileRecord> {
    await this.get(userId, id);
    const updated = await this.files.update(id, { starred });
    await this.activity.record({
      userId,
      action: starred ? "star" : "unstar",
      resourceType: "file",
      resourceId: id,
      resourceName: updated.name,
    });
    return updated;
  }

  /**
   * Moves a file to Trash (soft delete). The remote object is untouched, so
   * restore is lossless.
   */
  async trash(userId: string, id: string): Promise<FileRecord> {
    const record = await this.get(userId, id);
    if (record.deletedAt) return record;
    const updated = await this.files.update(id, {
      deletedAt: new Date(),
      trashBatchId: `solo-${id}`,
    });
    await this.activity.record({
      userId,
      action: "trash",
      resourceType: "file",
      resourceId: id,
      resourceName: updated.name,
    });
    return updated;
  }

  /** Restores a trashed file to its previous folder (or root). */
  async restore(userId: string, id: string): Promise<FileRecord> {
    const record = await this.get(userId, id);

    // If the original folder is gone or itself trashed, fall back to root so a
    // restore can never produce an orphaned file.
    let folderId = record.folderId;
    if (folderId !== null) {
      const folder = await this.folders.findById(folderId);
      if (!folder || folder.userId !== userId || folder.deletedAt) folderId = null;
    }

    const updated = await this.files.update(id, { deletedAt: null, trashBatchId: null, folderId });
    await this.activity.record({
      userId,
      action: "restore",
      resourceType: "file",
      resourceId: id,
      resourceName: updated.name,
    });
    return updated;
  }

  /**
   * Permanently deletes a file: the Telegram object is removed first, then the
   * metadata. If the remote delete fails we keep the metadata so the user can
   * retry, rather than silently orphaning the storage object.
   */
  async deletePermanently(userId: string, id: string): Promise<void> {
    const record = await this.get(userId, id);
    const engine = await this.engineFor(userId);

    // Every remote object (current and historical) must be gone before any
    // metadata is dropped. A failure here throws and leaves all pointers in
    // place, so a retry can finish the job without orphaning a Telegram message.
    const versions = await this.files.listVersions(id);
    const messageIds = new Set<string>([String(record.telegramMessageId)]);
    for (const version of versions) messageIds.add(String(version.telegramMessageId));
    for (const messageId of messageIds) {
      await engine.remove({ messageId });
    }

    await this.files.deleteVersionsByFileIds([id]);
    await this.files.deleteMany([id]);
    await this.activity.record({
      userId,
      action: "delete",
      resourceType: "file",
      resourceId: id,
      resourceName: record.name,
    });
  }

  /**
   * v0.1-compatible hard delete used by the current API: permanently removes
   * the file. Retained so existing clients keep working.
   */
  async delete(userId: string, id: string): Promise<void> {
    await this.deletePermanently(userId, id);
  }

  // ── Download ─────────────────────────────────────────────────────────────

  async download(userId: string, id: string, control: TransferControl = {}): Promise<FileDownload> {
    const record = await this.getActive(userId, id);
    const engine = await this.engineFor(userId);
    const data = await engine.download({ messageId: String(record.telegramMessageId) }, control);
    const integrityVerified = await engine.verifyIntegrity(data, record.sha256);
    await this.activity.record({
      userId,
      action: "download",
      resourceType: "file",
      resourceId: id,
      resourceName: record.name,
      metadata: { size: record.size, integrityVerified },
    });
    return { record, data, integrityVerified };
  }

  /**
   * Streaming download for large files. The caller must consume `stream` to
   * the end and then await `verified` to learn whether the bytes match the
   * stored checksum. The download activity is recorded when the stream opens.
   */
  async downloadStreamed(
    userId: string,
    id: string,
    control: TransferControl = {},
  ): Promise<FileStreamDownload> {
    const record = await this.getActive(userId, id);
    const engine = await this.engineFor(userId);
    const stream = await engine.downloadStream(
      { messageId: String(record.telegramMessageId) },
      record.sha256,
      control,
    );
    await this.activity.record({
      userId,
      action: "download",
      resourceType: "file",
      resourceId: id,
      resourceName: record.name,
      metadata: { size: record.size, streamed: true },
    });
    return { record, stream };
  }

  /** Records an "open" event (the UI opening the details panel, say). */
  async touch(userId: string, id: string, action: "open" = "open"): Promise<void> {
    const record = await this.get(userId, id);
    await this.activity.record({
      userId,
      action,
      resourceType: "file",
      resourceId: id,
      resourceName: record.name,
    });
  }

  // ── Batch operations ─────────────────────────────────────────────────────

  /**
   * Applies an operation to many files, collecting per-item failures instead
   * of aborting the whole batch.
   */
  async batch(
    userId: string,
    ids: string[],
    operation: "trash" | "restore" | "delete" | "star" | "unstar" | "move",
    options: { folderId?: string | null } = {},
  ): Promise<{
    requested: number;
    succeeded: number;
    failed: number;
    errors: { id: string; message: string }[];
  }> {
    const errors: { id: string; message: string }[] = [];
    let succeeded = 0;

    if (ids.length === 0) throw new ValidationError("No items selected");

    // Validate the destination once, so a bad folder fails the whole batch
    // rather than producing N identical errors.
    if (operation === "move") {
      const target = options.folderId ?? null;
      if (target !== null) await this.assertFolder(userId, target);
    }

    for (const id of ids) {
      try {
        switch (operation) {
          case "trash":
            await this.trash(userId, id);
            break;
          case "restore":
            await this.restore(userId, id);
            break;
          case "delete":
            await this.deletePermanently(userId, id);
            break;
          case "star":
            await this.setStarred(userId, id, true);
            break;
          case "unstar":
            await this.setStarred(userId, id, false);
            break;
          case "move":
            await this.move(userId, id, options.folderId ?? null);
            break;
        }
        succeeded += 1;
      } catch (error) {
        errors.push({ id, message: error instanceof Error ? error.message : "Operation failed" });
      }
    }

    return { requested: ids.length, succeeded, failed: errors.length, errors };
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async assertFolder(userId: string, folderId: string): Promise<void> {
    const folder = await this.folders.findById(folderId);
    if (!folder || folder.userId !== userId) {
      throw new NotFoundError("Folder not found", "folder");
    }
    if (folder.deletedAt) throw new ConflictError("The target folder is in the Trash");
  }
}
