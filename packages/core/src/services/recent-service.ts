import { paginationMeta } from "@omnicloud/shared";
import type { ActivityAction, RecentItemDTO, RecentPageDTO } from "@omnicloud/shared";
import type { PageRequest } from "../types";
import type { ActivityRepository, FileRepository } from "../repos";

/** Actions that count as meaningful "recent" activity for a file. */
const RECENT_ACTIONS: ActivityAction[] = [
  "upload",
  "download",
  "open",
  "rename",
  "move",
  "replace",
];

/**
 * Recent view: the most recently touched active files, newest activity first.
 * Trashed and permanently-deleted files are filtered out so the view never
 * surfaces items the user cannot open.
 */
export class RecentService {
  constructor(
    private readonly activity: ActivityRepository,
    private readonly files: FileRepository,
  ) {}

  async list(userId: string, page: PageRequest): Promise<RecentPageDTO> {
    // Pull a bounded window of recent *meaningful* events (the repository
    // dedups by file), then resolve the distinct files.
    const window = Math.min(page.page * page.limit * 3, 500);
    const events = await this.activity.recentFiles(userId, RECENT_ACTIONS, window);

    const seen = new Set<string>();
    for (const event of events) {
      seen.add(event.resourceId);
    }

    const fileIds = [...seen];
    const records = fileIds.length > 0 ? await this.files.listByIds(userId, fileIds) : [];
    const byId = new Map(records.map((record) => [record.id, record]));

    const items: RecentItemDTO[] = [];
    for (const fileId of fileIds) {
      const record = byId.get(fileId);
      if (!record || record.deletedAt !== null) continue;
      const event = events.find((candidate) => candidate.resourceId === fileId)!;
      items.push({
        file: {
          id: record.id,
          name: record.name,
          size: record.size,
          mimeType: record.mimeType,
          sha256: record.sha256,
          folderId: record.folderId,
          starred: record.starred,
          trashed: false,
          deletedAt: null,
          versionCount: record.versionCount,
          currentVersionId: record.currentVersionId,
          createdAt: record.createdAt.toISOString(),
          updatedAt: record.updatedAt.toISOString(),
        },
        lastAction: event.action,
        lastActionAt: event.createdAt.toISOString(),
      });
    }

    const start = (page.page - 1) * page.limit;
    const pageItems = items.slice(start, start + page.limit);

    return {
      items: pageItems,
      pagination: paginationMeta(page.page, page.limit, items.length),
    };
  }
}
