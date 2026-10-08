import { paginationMeta } from "@omnicloud/shared";
import type { ListQuery, PaginationDTO } from "@omnicloud/shared";
import type { FileRecord, FolderRecord, PageRequest } from "../types";
import type { FileRepository, FolderRepository } from "../repos";
import { NotFoundError } from "../errors";
import type { EngineResolver } from "./file-service";
import { resolveItemQuery } from "./query-resolver";

export interface TrashListing {
  files: FileRecord[];
  folders: FolderRecord[];
  pagination: PaginationDTO;
}

export interface EmptyTrashResult {
  deletedFiles: number;
  deletedFolders: number;
  failedFiles: number;
}

/**
 * Trash is a virtual view over soft-deleted rows. Listing shows only the
 * explicitly trashed items; emptying removes their remote objects before the
 * metadata, and reports failures instead of hiding them.
 */
export class TrashService {
  constructor(
    private readonly files: FileRepository,
    private readonly folders: FolderRepository,
    private readonly engineFor: EngineResolver,
  ) {}

  async list(userId: string, page: PageRequest, extra: ListQuery = {}): Promise<TrashListing> {
    const itemQuery = await resolveItemQuery(this.folders, userId, {
      ...extra,
      status: "trashed",
      folderId: undefined,
    });

    const [filePage, folderPage] = await Promise.all([
      this.files.query(userId, itemQuery, page),
      this.folders.query(userId, itemQuery, page),
    ]);

    const total = filePage.total + folderPage.total;
    return {
      files: filePage.items,
      folders: folderPage.items,
      pagination: paginationMeta(page.page, page.limit, total),
    };
  }

  /**
   * Permanently removes everything in the Trash for a user. Folders are
   * processed root-first so removing a parent also removes its contents.
   */
  async empty(userId: string): Promise<EmptyTrashResult> {
    const engine = await this.engineFor(userId);
    const allFiles = await this.files.listByUser(userId);
    const trashedFiles = allFiles.filter((file) => file.deletedAt !== null);

    let deletedFiles = 0;
    let failedFiles = 0;
    const deletedFileIds: string[] = [];

    for (const file of trashedFiles) {
      try {
        await engine.remove({ messageId: String(file.telegramMessageId) });
        deletedFileIds.push(file.id);
        deletedFiles += 1;
      } catch {
        failedFiles += 1;
      }
    }

    if (deletedFileIds.length > 0) {
      await this.files.deleteVersionsByFileIds(deletedFileIds);
      await this.files.deleteMany(deletedFileIds);
    }

    // Remove trashed folders, shallowest first, and only those with no
    // remaining files inside.
    const allFolders = await this.folders.listByUser(userId);
    const trashedFolders = allFolders.filter((folder) => folder.deletedAt !== null);
    const depth = (folder: FolderRecord): number => {
      let level = 0;
      let cursor = folder.parentId;
      const seen = new Set<string>();
      while (cursor !== null && !seen.has(cursor)) {
        seen.add(cursor);
        const parent = allFolders.find((candidate) => candidate.id === cursor);
        if (!parent) break;
        level += 1;
        cursor = parent.parentId;
      }
      return level;
    };
    trashedFolders.sort((a, b) => depth(a) - depth(b));

    let deletedFolders = 0;
    for (const folder of trashedFolders) {
      // Skip folders that still contain files we could not delete.
      const stillHasFiles = await this.files.query(
        userId,
        { folderId: folder.id, trashed: true },
        { page: 1, limit: 1 },
      );
      if (stillHasFiles.total > 0) continue;
      await this.folders.deleteMany([folder.id]);
      deletedFolders += 1;
    }

    return { deletedFiles, deletedFolders, failedFiles };
  }

  /** Restores a single trashed item (used by the batch restore endpoint). */
  async verifyTrashedFile(userId: string, id: string): Promise<FileRecord> {
    const file = await this.files.findById(id);
    if (!file || file.userId !== userId || file.deletedAt === null) {
      throw new NotFoundError("File is not in the Trash", "file");
    }
    return file;
  }
}
