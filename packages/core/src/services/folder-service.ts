import type { ListQuery } from "@omnicloud/shared";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { sanitizeFileName } from "../utils/filename";
import type { FolderRecord, ItemQuery, PageRequest, Paged } from "../types";
import type { FileRepository, FolderRepository } from "../repos";
import type { EngineResolver } from "./file-service";
import type { ActivityRecorder } from "./activity-service";
import { noopActivityRecorder } from "./activity-service";
import { resolveItemQuery } from "./query-resolver";

export interface FolderMutationResult {
  affectedFolders: number;
  affectedFiles: number;
}

export interface FolderTree {
  folders: FolderRecord[];
}

/**
 * Folder lifecycle (v0.2):
 *
 *  - Folders are virtual OmniCloud objects with a parent-child hierarchy.
 *  - Trashing a folder trashes its whole subtree (folders + files) without
 *    touching Telegram, so restore is lossless.
 *  - Restoring a folder restores only the nodes that were trashed together
 *    with it; anything the user trashed separately stays in the Trash.
 *  - Permanent deletion removes remote objects first, then metadata.
 */
export class FolderService {
  constructor(
    private readonly folders: FolderRepository,
    private readonly files: FileRepository,
    private readonly engineFor: EngineResolver,
    private readonly activity: ActivityRecorder = noopActivityRecorder,
  ) {}

  // ── Create / read ────────────────────────────────────────────────────────

  async create(
    userId: string,
    input: { name: string; parentId: string | null },
  ): Promise<FolderRecord> {
    const name = sanitizeFileName(input.name);
    if (!name) throw new ValidationError("Invalid folder name");
    if (input.parentId !== null) {
      const parent = await this.get(userId, input.parentId);
      if (parent.deletedAt) throw new ConflictError("The parent folder is in the Trash");
    }
    const folder = await this.folders.create({ userId, parentId: input.parentId, name });
    await this.activity.record({
      userId,
      action: "create_folder",
      resourceType: "folder",
      resourceId: folder.id,
      resourceName: folder.name,
    });
    return folder;
  }

  /** Active folders directly inside a folder (null = root). */
  async listChildren(userId: string, parentId: string | null): Promise<FolderRecord[]> {
    if (parentId !== null) await this.get(userId, parentId);
    return this.folders.listChildren(userId, parentId);
  }

  async query(userId: string, input: ListQuery, page: PageRequest): Promise<Paged<FolderRecord>> {
    const query: ItemQuery = await resolveItemQuery(this.folders, userId, input);
    return this.folders.query(userId, query, page);
  }

  /** Every active folder for the user (used to build trees). */
  async tree(userId: string): Promise<FolderRecord[]> {
    const all = await this.folders.listByUser(userId);
    return all.filter((folder) => folder.deletedAt === null);
  }

  async get(userId: string, id: string): Promise<FolderRecord> {
    const record = await this.folders.findById(id);
    if (!record || record.userId !== userId) throw new NotFoundError("Folder not found", "folder");
    return record;
  }

  // ── Mutations ────────────────────────────────────────────────────────────

  async rename(userId: string, id: string, name: string): Promise<FolderRecord> {
    const existing = await this.get(userId, id);
    const clean = sanitizeFileName(name);
    if (!clean) throw new ValidationError("Invalid folder name");
    const updated = await this.folders.update(id, { name: clean });
    await this.activity.record({
      userId,
      action: "rename",
      resourceType: "folder",
      resourceId: id,
      resourceName: clean,
      metadata: { previousName: existing.name },
    });
    return updated;
  }

  async move(userId: string, id: string, newParentId: string | null): Promise<FolderRecord> {
    const existing = await this.get(userId, id);

    if (newParentId === id) throw new ValidationError("Cannot move a folder into itself");

    if (newParentId !== null) {
      const target = await this.get(userId, newParentId);
      if (target.deletedAt) throw new ConflictError("The target folder is in the Trash");

      // Walk up from the new parent; hitting the folder being moved means it
      // would become its own ancestor.
      let cursor: string | null = newParentId;
      while (cursor !== null) {
        if (cursor === id) {
          throw new ValidationError("Cannot move a folder into one of its subfolders");
        }
        const parent = await this.folders.findById(cursor);
        if (!parent || parent.userId !== userId)
          throw new NotFoundError("Folder not found", "folder");
        cursor = parent.parentId;
      }
    }

    const updated = await this.folders.update(id, { parentId: newParentId });
    await this.activity.record({
      userId,
      action: "move",
      resourceType: "folder",
      resourceId: id,
      resourceName: updated.name,
      metadata: { from: existing.parentId, to: newParentId },
    });
    return updated;
  }

  async setStarred(userId: string, id: string, starred: boolean): Promise<FolderRecord> {
    await this.get(userId, id);
    const updated = await this.folders.update(id, { starred });
    await this.activity.record({
      userId,
      action: starred ? "star" : "unstar",
      resourceType: "folder",
      resourceId: id,
      resourceName: updated.name,
    });
    return updated;
  }

  // ── Trash lifecycle ──────────────────────────────────────────────────────

  /**
   * Moves a folder and its entire subtree to the Trash. Nothing is deleted
   * from Telegram, so restore is lossless.
   */
  async trash(userId: string, id: string): Promise<FolderMutationResult> {
    const record = await this.get(userId, id);
    if (record.deletedAt) {
      return { affectedFolders: 1, affectedFiles: 0 };
    }

    const subtree = await this.collectSubtree(userId, id);
    const fileIds = await this.collectFileIds(userId, subtree);

    // One batch id stamps everything this operation trashes, so restore can
    // bring back exactly this set without relying on timestamp equality.
    const batchId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const stampedAt = new Date();
    await this.folders.updateMany(
      subtree.map((folder) => folder.id),
      { deletedAt: stampedAt, trashBatchId: batchId },
    );
    await this.files.updateMany(fileIds, { deletedAt: stampedAt, trashBatchId: batchId });

    await this.activity.record({
      userId,
      action: "trash",
      resourceType: "folder",
      resourceId: id,
      resourceName: record.name,
      metadata: { folders: subtree.length, files: fileIds.length },
    });

    return { affectedFolders: subtree.length, affectedFiles: fileIds.length };
  }

  /**
   * Restores a folder subtree. Only nodes trashed at the same instant as the
   * folder itself are restored, so items the user trashed separately stay put.
   */
  async restore(userId: string, id: string): Promise<FolderMutationResult> {
    const record = await this.get(userId, id);

    // If the parent chain is still trashed, restore to the root instead of
    // creating a folder the user cannot see.
    let parentId = record.parentId;
    if (parentId !== null) {
      const parent = await this.folders.findById(parentId);
      if (!parent || parent.deletedAt) parentId = null;
    }

    const subtree = await this.collectSubtree(userId, id, { includeTrashed: true });
    const batchId = record.trashBatchId;

    // Prefer the batch marker; fall back to timestamp equality for rows
    // created before the marker existed (v0.2 upgrade path).
    const belongsToBatch = (deletedAt: Date | null, marker: string | null): boolean =>
      deletedAt !== null &&
      (batchId !== null
        ? marker === batchId
        : record.deletedAt !== null && deletedAt.getTime() === record.deletedAt.getTime());

    const restorableFolders = subtree.filter((folder) =>
      belongsToBatch(folder.deletedAt, folder.trashBatchId),
    );
    const restorableFolderIds = new Set(restorableFolders.map((folder) => folder.id));

    const allFiles = await this.files.listByUser(userId);
    const restorableFiles = allFiles.filter(
      (file) =>
        file.folderId !== null &&
        restorableFolderIds.has(file.folderId) &&
        belongsToBatch(file.deletedAt, file.trashBatchId),
    );

    const restorableFileIds = restorableFiles.map((file) => file.id);
    if (restorableFolders.length > 0) {
      await this.folders.updateMany(
        restorableFolders.map((folder) => folder.id),
        { deletedAt: null, trashBatchId: null },
      );
      await this.folders.update(id, { parentId });
    }
    if (restorableFileIds.length > 0) {
      await this.files.updateMany(restorableFileIds, { deletedAt: null, trashBatchId: null });
    }

    await this.activity.record({
      userId,
      action: "restore",
      resourceType: "folder",
      resourceId: id,
      resourceName: record.name,
      metadata: { folders: restorableFolders.length, files: restorableFiles.length },
    });

    return { affectedFolders: restorableFolders.length, affectedFiles: restorableFiles.length };
  }

  /**
   * Permanently deletes a folder subtree: remote objects first, then
   * metadata. Files whose remote delete fails are left in the Trash so the
   * user can retry rather than losing data silently.
   */
  async deletePermanently(userId: string, id: string): Promise<FolderMutationResult> {
    await this.get(userId, id);

    const subtree = await this.collectSubtree(userId, id, { includeTrashed: true });
    const folderIds = subtree.map((folder) => folder.id);

    const allFiles = await this.files.listByUser(userId);
    const affected = allFiles.filter(
      (file) => file.folderId !== null && folderIds.includes(file.folderId),
    );

    const engine = await this.engineFor(userId);
    const removedFileIds: string[] = [];
    for (const file of affected) {
      try {
        await engine.remove({ messageId: String(file.telegramMessageId) });
        removedFileIds.push(file.id);
      } catch {
        // Keep the metadata so the operation can be retried.
      }
    }

    if (removedFileIds.length > 0) {
      await this.files.deleteVersionsByFileIds(removedFileIds);
      await this.files.deleteMany(removedFileIds);
    }

    // Only delete folders whose files are all gone, plus empty leaves.
    const remainingFolderIds = new Set(
      affected.filter((file) => !removedFileIds.includes(file.id)).map((file) => file.folderId),
    );
    const deletable = folderIds.filter((folderId) => !remainingFolderIds.has(folderId));
    if (deletable.length > 0) {
      await this.folders.deleteMany(deletable);
    }

    await this.activity.record({
      userId,
      action: "delete",
      resourceType: "folder",
      resourceId: id,
      resourceName: subtree[0]?.name ?? "folder",
      metadata: { folders: deletable.length, files: removedFileIds.length },
    });

    return { affectedFolders: deletable.length, affectedFiles: removedFileIds.length };
  }

  /**
   * v0.1-compatible recursive delete. Now routes through the v0.2 permanent
   * delete so remote cleanup and orphan prevention are consistent.
   */
  async delete(userId: string, id: string): Promise<FolderMutationResult> {
    return this.deletePermanently(userId, id);
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** The folder plus every descendant (BFS), optionally including trashed. */
  private async collectSubtree(
    userId: string,
    rootId: string,
    options: { includeTrashed?: boolean } = {},
  ): Promise<FolderRecord[]> {
    const all = await this.folders.listByUser(userId);
    const childrenOf = new Map<string | null, FolderRecord[]>();
    for (const folder of all) {
      const list = childrenOf.get(folder.parentId) ?? [];
      list.push(folder);
      childrenOf.set(folder.parentId, list);
    }

    const root = all.find((folder) => folder.id === rootId);
    if (!root) throw new NotFoundError("Folder not found", "folder");

    const collected: FolderRecord[] = [root];
    const queue: string[] = [rootId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const child of childrenOf.get(current) ?? []) {
        if (!options.includeTrashed && child.deletedAt) continue;
        collected.push(child);
        queue.push(child.id);
      }
    }
    return collected;
  }

  /** Ids of files inside the given folders that are not already trashed. */
  private async collectFileIds(userId: string, folders: FolderRecord[]): Promise<string[]> {
    const ids = new Set(folders.map((folder) => folder.id));
    const allFiles = await this.files.listByUser(userId);
    return allFiles
      .filter((file) => file.deletedAt === null && file.folderId !== null && ids.has(file.folderId))
      .map((file) => file.id);
  }
}
