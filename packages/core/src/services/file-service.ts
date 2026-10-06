import { NotFoundError, ValidationError } from "../errors";
import { sanitizeFileName } from "../utils/filename";
import { mimeFromFilename } from "@omnicloud/shared";
import type { FileRecord } from "../types";
import type { FileRepository, FolderRepository } from "../repos";
import type { StorageEngine } from "../storage/engine";

export interface FileDownload {
  record: FileRecord;
  data: Buffer;
  integrityVerified: boolean;
}

export type EngineResolver = (userId: string) => Promise<StorageEngine>;

/**
 * All file metadata operations. Every method verifies ownership: records
 * belonging to other users are reported as missing.
 */
export class FileService {
  constructor(
    private readonly files: FileRepository,
    private readonly folders: FolderRepository,
    private readonly engineFor: EngineResolver,
  ) {}

  async upload(
    userId: string,
    input: { folderId: string | null; name: string; data: Buffer },
  ): Promise<FileRecord> {
    const name = sanitizeFileName(input.name);
    if (!name) throw new ValidationError("Invalid file name");

    if (input.folderId !== null) {
      const folder = await this.folders.findById(input.folderId);
      if (!folder || folder.userId !== userId) throw new NotFoundError("Folder not found");
    }

    const mimeType = mimeFromFilename(name);
    const engine = await this.engineFor(userId);

    // Upload first; metadata is only persisted once the provider succeeds.
    const { stored, sha256, size } = await engine.upload({ name, mimeType, data: input.data });

    return this.files.create({
      userId,
      folderId: input.folderId,
      name,
      size,
      mimeType,
      sha256,
      telegramMessageId: Number(stored.messageId),
    });
  }

  async list(userId: string, folderId: string | null): Promise<FileRecord[]> {
    if (folderId !== null) {
      const folder = await this.folders.findById(folderId);
      if (!folder || folder.userId !== userId) throw new NotFoundError("Folder not found");
    }
    return this.files.listByFolder(userId, folderId);
  }

  async get(userId: string, id: string): Promise<FileRecord> {
    const record = await this.files.findById(id);
    if (!record || record.userId !== userId) throw new NotFoundError("File not found");
    return record;
  }

  async rename(userId: string, id: string, name: string): Promise<FileRecord> {
    await this.get(userId, id);
    const clean = sanitizeFileName(name);
    if (!clean) throw new ValidationError("Invalid file name");
    return this.files.update(id, { name: clean });
  }

  async move(userId: string, id: string, folderId: string | null): Promise<FileRecord> {
    await this.get(userId, id);
    if (folderId !== null) {
      const folder = await this.folders.findById(folderId);
      if (!folder || folder.userId !== userId) throw new NotFoundError("Folder not found");
    }
    return this.files.update(id, { folderId });
  }

  async delete(userId: string, id: string): Promise<void> {
    const record = await this.get(userId, id);
    const engine = await this.engineFor(userId);
    try {
      await engine.remove({ messageId: String(record.telegramMessageId) });
    } catch {
      // The remote object is already gone or unreachable; still remove the
      // metadata so the file does not linger in the user's drive.
    }
    await this.files.deleteMany([record.id]);
  }

  async download(userId: string, id: string): Promise<FileDownload> {
    const record = await this.get(userId, id);
    const engine = await this.engineFor(userId);
    const data = await engine.download({ messageId: String(record.telegramMessageId) });
    const integrityVerified = await engine.verifyIntegrity(data, record.sha256);
    return { record, data, integrityVerified };
  }
}
