import type { ActivityAction, ResourceType } from "@omnicloud/shared";
import type {
  ActivityEventRecord,
  FileRecord,
  FileVersionRecord,
  FolderRecord,
  ItemQuery,
  PageRequest,
  Paged,
  StorageRecord,
  TelegramSessionRecord,
  UserRecord,
} from "./types";

/**
 * Repository interfaces. The application depends on these, not on a specific
 * database — the Prisma implementation lives in @omnicloud/database, and
 * tests use in-memory implementations.
 */

export interface UserRepository {
  findById(id: string): Promise<UserRecord | null>;
  findByTelegramId(telegramUserId: string): Promise<UserRecord | null>;
  upsertFromTelegram(input: {
    telegramUserId: string;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
  }): Promise<UserRecord>;
}

export interface SessionRepository {
  get(userId: string): Promise<TelegramSessionRecord | null>;
  save(userId: string, stringSession: string): Promise<void>;
  delete(userId: string): Promise<void>;
}

export interface StorageRepository {
  findByUserAndProvider(userId: string, provider: string): Promise<StorageRecord | null>;
  create(input: {
    userId: string;
    provider: string;
    title: string;
    telegramChatId: string;
    telegramAccessHash: string;
  }): Promise<StorageRecord>;
}

export interface FolderCreateInput {
  userId: string;
  parentId: string | null;
  name: string;
}

export interface FolderRepository {
  create(input: FolderCreateInput): Promise<FolderRecord>;
  findById(id: string): Promise<FolderRecord | null>;
  /** Every folder belonging to the user (used for trees and cascade logic). */
  listByUser(userId: string): Promise<FolderRecord[]>;
  listChildren(userId: string, parentId: string | null): Promise<FolderRecord[]>;
  /** Filtered, sorted, paginated listing. */
  query(userId: string, query: ItemQuery, page: PageRequest): Promise<Paged<FolderRecord>>;
  /** Folder ids matching a name substring (used to resolve `folder:` filters). */
  findIdsByName(userId: string, name: string): Promise<string[]>;
  update(
    id: string,
    patch: {
      name?: string;
      parentId?: string | null;
      starred?: boolean;
      deletedAt?: Date | null;
      trashBatchId?: string | null;
    },
  ): Promise<FolderRecord>;
  /** Bulk trash/restore/star without touching files. */
  updateMany(
    ids: string[],
    patch: { starred?: boolean; deletedAt?: Date | null; trashBatchId?: string | null },
  ): Promise<number>;
  deleteMany(ids: string[]): Promise<void>;
  countByUser(userId: string): Promise<number>;
}

export interface FileCreateInput {
  userId: string;
  folderId: string | null;
  name: string;
  size: number;
  mimeType: string;
  sha256: string;
  telegramMessageId: number;
}

export interface FileRepository {
  create(input: FileCreateInput): Promise<FileRecord>;
  findById(id: string): Promise<FileRecord | null>;
  /** Active files directly inside a folder (null = root). */
  listByFolder(userId: string, folderId: string | null): Promise<FileRecord[]>;
  listByUser(userId: string): Promise<FileRecord[]>;
  listByIds(userId: string, ids: string[]): Promise<FileRecord[]>;
  query(userId: string, query: ItemQuery, page: PageRequest): Promise<Paged<FileRecord>>;
  update(
    id: string,
    patch: {
      name?: string;
      folderId?: string | null;
      starred?: boolean;
      deletedAt?: Date | null;
      trashBatchId?: string | null;
      size?: number;
      mimeType?: string;
      sha256?: string;
      telegramMessageId?: number;
      currentVersionId?: string | null;
      versionCount?: number;
    },
  ): Promise<FileRecord>;
  updateMany(
    ids: string[],
    patch: {
      folderId?: string | null;
      starred?: boolean;
      deletedAt?: Date | null;
      trashBatchId?: string | null;
    },
  ): Promise<number>;
  /** Aggregate counters used by the storage dashboard. */
  statsByUser(userId: string): Promise<{
    fileCount: number;
    folderCount: number;
    totalBytes: number;
    trashBytes: number;
    trashFileCount: number;
    starredCount: number;
  }>;
  deleteMany(ids: string[]): Promise<void>;

  // ── Versioning foundation ────────────────────────────────────────────────
  createVersion(input: {
    fileId: string;
    userId: string;
    size: number;
    mimeType: string;
    sha256: string;
    telegramMessageId: number;
  }): Promise<FileVersionRecord>;
  listVersions(fileId: string): Promise<FileVersionRecord[]>;
  findVersionById(versionId: string): Promise<FileVersionRecord | null>;
  countVersions(fileId: string): Promise<number>;
  deleteVersionsByFileIds(fileIds: string[]): Promise<void>;
}

export interface ActivityRepository {
  record(input: {
    userId: string;
    action: ActivityAction;
    resourceType: ResourceType;
    resourceId: string;
    resourceName?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void>;
  /** Newest-first activity for a user. */
  list(userId: string, page: PageRequest): Promise<Paged<ActivityEventRecord>>;
  /**
   * Most recent distinct files for the given actions, newest first. Only
   * events whose action is listed are considered, so a file whose latest
   * event is (say) a star still surfaces via its last meaningful action.
   */
  recentFiles(
    userId: string,
    actions: readonly ActivityAction[],
    limit: number,
  ): Promise<ActivityEventRecord[]>;
  countByUser(userId: string): Promise<number>;
  /** Housekeeping: drop events older than the retention window. */
  pruneOlderThan(cutoff: Date): Promise<number>;
}

export interface Repos {
  users: UserRepository;
  sessions: SessionRepository;
  storages: StorageRepository;
  folders: FolderRepository;
  files: FileRepository;
  activity: ActivityRepository;
}
