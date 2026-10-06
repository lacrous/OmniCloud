import { NotFoundError, ValidationError } from "../errors";
import { sanitizeFileName } from "../utils/filename";
import type { FolderRecord } from "../types";
import type { FileRepository, FolderRepository } from "../repos";
import type { EngineResolver } from "./file-service";

export interface FolderDeletionResult {
  deletedFolders: number;
  deletedFiles: number;
}

/**
 * Folder deletion semantics (v0.1): deleting a folder recursively deletes
 * all descendant folders and the files inside them, including the remote
 * storage objects. Files directly inside the deleted hierarchy are removed,
 * not relocated.
 */
export class FolderService {
  constructor(
    private readonly folders: FolderRepository,
    private readonly files: FileRepository,
    private readonly engineFor: EngineResolver,
  ) {}

  async create(
    userId: string,
    input: { name: string; parentId: string | null },
  ): Promise<FolderRecord> {
    const name = sanitizeFileName(input.name);
    if (!name) throw new ValidationError("Invalid folder name");
    if (input.parentId !== null) {
      const parent = await this.folders.findById(input.parentId);
      if (!parent || parent.userId !== userId) throw new NotFoundError("Folder not found");
    }
    return this.folders.create({ userId, parentId: input.parentId, name });
  }

  async listChildren(userId: string, parentId: string | null): Promise<FolderRecord[]> {
    if (parentId !== null) {
      const parent = await this.folders.findById(parentId);
      if (!parent || parent.userId !== userId) throw new NotFoundError("Folder not found");
    }
    return this.folders.listChildren(userId, parentId);
  }

  async tree(userId: string): Promise<FolderRecord[]> {
    return this.folders.listByUser(userId);
  }

  async get(userId: string, id: string): Promise<FolderRecord> {
    const record = await this.folders.findById(id);
    if (!record || record.userId !== userId) throw new NotFoundError("Folder not found");
    return record;
  }

  async rename(userId: string, id: string, name: string): Promise<FolderRecord> {
    await this.get(userId, id);
    const clean = sanitizeFileName(name);
    if (!clean) throw new ValidationError("Invalid folder name");
    return this.folders.update(id, { name: clean });
  }

  async move(userId: string, id: string, newParentId: string | null): Promise<FolderRecord> {
    await this.get(userId, id);

    if (newParentId === id) throw new ValidationError("Cannot move a folder into itself");

    if (newParentId !== null) {
      // Walk up from the new parent; hitting the folder being moved means it
      // would become its own ancestor.
      let cursor: string | null = newParentId;
      while (cursor !== null) {
        if (cursor === id) {
          throw new ValidationError("Cannot move a folder into one of its subfolders");
        }
        const parent = await this.folders.findById(cursor);
        if (!parent || parent.userId !== userId) throw new NotFoundError("Folder not found");
        cursor = parent.parentId;
      }
    }

    return this.folders.update(id, { parentId: newParentId });
  }

  async delete(userId: string, id: string): Promise<FolderDeletionResult> {
    await this.get(userId, id);

    const all = await this.folders.listByUser(userId);
    const childrenOf = new Map<string | null, string[]>();
    for (const folder of all) {
      const list = childrenOf.get(folder.parentId) ?? [];
      list.push(folder.id);
      childrenOf.set(folder.parentId, list);
    }

    // Collect the folder and all descendants (BFS).
    const doomed: string[] = [id];
    const queue = [id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const child of childrenOf.get(current) ?? []) {
        doomed.push(child);
        queue.push(child);
      }
    }
    const doomedSet = new Set(doomed);

    const userFiles = await this.files.listByUser(userId);
    const affectedFiles = userFiles.filter((f) => f.folderId !== null && doomedSet.has(f.folderId));

    // Best effort: remove remote objects first so metadata deletion below
    // always succeeds. A leftover remote object is harmless; a stuck folder
    // is not.
    const engine = await this.engineFor(userId);
    for (const file of affectedFiles) {
      try {
        await engine.remove({ messageId: String(file.telegramMessageId) });
      } catch {
        // Ignore individual failures — metadata cleanup must proceed.
      }
    }

    await this.files.deleteMany(affectedFiles.map((f) => f.id));
    await this.folders.deleteMany(doomed);

    return { deletedFolders: doomed.length, deletedFiles: affectedFiles.length };
  }
}
