import { fileCategory } from "@omnicloud/shared";
import type { StorageStats } from "../types";
import type { FileRepository, FolderRepository } from "../repos";

const LARGEST_FILES = 10;

/**
 * Storage dashboard statistics, computed from PostgreSQL metadata only —
 * no Telegram round-trips, so the page is fast and works offline.
 */
export class StatsService {
  constructor(
    private readonly files: FileRepository,
    private readonly folders: FolderRepository,
  ) {}

  async stats(userId: string, quotaBytes: number | null = null): Promise<StorageStats> {
    const [counters, allFiles] = await Promise.all([
      this.files.statsByUser(userId),
      // Metadata-only aggregation; v0.2 datasets fit comfortably in memory.
      this.files.listByUser(userId),
    ]);

    const active = allFiles.filter((file) => file.deletedAt === null);
    const categoryBytes = new Map<string, { bytes: number; count: number }>();

    for (const file of active) {
      const category = fileCategory(file.mimeType);
      const bucket = categoryBytes.get(category) ?? { bytes: 0, count: 0 };
      bucket.bytes += file.size;
      bucket.count += 1;
      categoryBytes.set(category, bucket);
    }

    const byType = [...categoryBytes.entries()]
      .map(([category, bucket]) => ({ category, bytes: bucket.bytes, count: bucket.count }))
      .sort((a, b) => b.bytes - a.bytes);

    const largestFiles = [...active].sort((a, b) => b.size - a.size).slice(0, LARGEST_FILES);

    return {
      fileCount: counters.fileCount,
      folderCount: counters.folderCount,
      totalBytes: counters.totalBytes,
      trashBytes: counters.trashBytes,
      trashFileCount: counters.trashFileCount,
      starredCount: counters.starredCount,
      byType,
      largestFiles,
      quotaBytes,
    };
  }
}
