import { ValidationError } from "../errors";
import type { FileRecord, FolderRecord } from "../types";
import type { FileRepository, FolderRepository } from "../repos";

const MAX_QUERY_LENGTH = 100;

/** Metadata-based search over file and folder names (PostgreSQL-backed). */
export class SearchService {
  constructor(
    private readonly files: FileRepository,
    private readonly folders: FolderRepository,
  ) {}

  async search(
    userId: string,
    query: string,
    limit = 25,
  ): Promise<{ files: FileRecord[]; folders: FolderRecord[] }> {
    const q = query.trim();
    if (!q) throw new ValidationError("Search query must not be empty");
    if (q.length > MAX_QUERY_LENGTH) {
      throw new ValidationError(`Search query must be at most ${MAX_QUERY_LENGTH} characters`);
    }
    const [fileResults, folderResults] = await Promise.all([
      this.files.searchByName(userId, q, limit),
      this.folders.searchByName(userId, q, limit),
    ]);
    return { files: fileResults, folders: folderResults };
  }
}
