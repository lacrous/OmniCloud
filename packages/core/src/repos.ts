import type { UploadOperationStatus } from "./services/upload-operation";
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

export interface BrowserSessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  userAgent: string | null;
  ip: string | null;
}

/** Server-side browser sessions. Holds only token hashes, never raw tokens. */
export interface BrowserSessionRepository {
  create(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent: string | null;
    ip: string | null;
  }): Promise<BrowserSessionRecord>;
  findByTokenHash(tokenHash: string): Promise<BrowserSessionRecord | null>;
  touch(id: string, at: Date): Promise<void>;
  revoke(id: string, at: Date): Promise<void>;
  revokeAllForUser(userId: string, at: Date): Promise<number>;
  listActiveForUser(userId: string, now: Date): Promise<BrowserSessionRecord[]>;
  deleteExpiredBefore(cutoff: Date): Promise<number>;
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
  /**
   * Re-parents a folder only if the result stays acyclic. The ancestor check and
   * the write are one atomic step, so two concurrent moves cannot each pass the
   * check and together create a cycle. Throws ConflictError on a cycle.
   */
  moveSafely(id: string, newParentId: string | null): Promise<FolderRecord>;
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
  /**
   * Trashes a folder subtree and the files inside it in one atomic step, so a
   * failure cannot leave the folders trashed while their files stay active.
   */
  trashSubtree(
    folderIds: string[],
    fileIds: string[],
    stamp: { deletedAt: Date; trashBatchId: string },
  ): Promise<void>;
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

export interface UploadOperationRecord {
  id: string;
  userId: string;
  operationId: string;
  status: UploadOperationStatus;
  /** Set once the Telegram object exists, so recovery can commit without re-uploading. */
  telegramMessageId: number | null;
  sha256: string | null;
  size: number | null;
  /** Digest of the original request (name, folder, target, content). Replays must match it. */
  requestFingerprint: string | null;
  fileId: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Durable upload attempts, scoped to the owning user. */
export interface UploadOperationRepository {
  findByOperationId(userId: string, operationId: string): Promise<UploadOperationRecord | null>;
  /** Operations for a user in the given states (used by reconciliation). */
  listByStatus(userId: string, status: UploadOperationStatus): Promise<UploadOperationRecord[]>;
  create(input: {
    userId: string;
    operationId: string;
    requestFingerprint?: string | null;
  }): Promise<UploadOperationRecord>;
  /**
   * Atomically moves an operation from `from` to `to` if, and only if, it is
   * still in `from`. Returns false when another request already moved it, so
   * exactly one request performs the upload.
   */
  claim(id: string, from: UploadOperationStatus, to: UploadOperationStatus): Promise<boolean>;
  update(
    id: string,
    patch: Partial<
      Pick<
        UploadOperationRecord,
        "status" | "telegramMessageId" | "sha256" | "size" | "fileId" | "error"
      >
    >,
  ): Promise<UploadOperationRecord>;
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
  /** All versions for many files in one query, grouped by file id. */
  listVersionsForFiles(fileIds: string[]): Promise<Map<string, FileVersionRecord[]>>;
  findVersionById(versionId: string): Promise<FileVersionRecord | null>;
  countVersions(fileId: string): Promise<number>;
  deleteVersionsByFileIds(fileIds: string[]): Promise<void>;
  /** Removes one version row. Callers must delete its Telegram object first. */
  deleteVersion(versionId: string): Promise<void>;
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
  browserSessions: BrowserSessionRepository;
  uploadOperations: UploadOperationRepository;
  storages: StorageRepository;
  folders: FolderRepository;
  files: FileRepository;
  activity: ActivityRepository;
}
