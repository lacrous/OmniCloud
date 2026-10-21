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
  /** Every user, for scheduled maintenance such as the trash purge. */
  listAll(): Promise<UserRecord[]>;
  upsertFromTelegram(input: {
    telegramUserId: string;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
  }): Promise<UserRecord>;
  /**
   * Opaque OCE1 recovery blob. Kept off UserRecord so it cannot leak into
   * DTOs, logs, or activity metadata; only the dedicated endpoints read it.
   */
  getRecoveryBlob(userId: string): Promise<string | null>;
  setRecoveryBlob(userId: string, blob: string | null): Promise<void>;
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

export interface ApiTokenRecord {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  createdAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

/** Personal API tokens. Holds only token hashes, never raw tokens. */
export interface ApiTokenRepository {
  create(input: { userId: string; name: string; tokenHash: string }): Promise<ApiTokenRecord>;
  findByTokenHash(tokenHash: string): Promise<ApiTokenRecord | null>;
  findByIdForUser(userId: string, id: string): Promise<ApiTokenRecord | null>;
  listForUser(userId: string): Promise<ApiTokenRecord[]>;
  touch(id: string, at: Date): Promise<void>;
  revoke(id: string, at: Date): Promise<void>;
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
   *
   * The write is scoped to `userId`. The caller checks ownership too, but the
   * predicate is repeated here so that a bug in a caller cannot trash another
   * account's items.
   */
  trashSubtree(
    userId: string,
    folderIds: string[],
    fileIds: string[],
    stamp: { deletedAt: Date; trashBatchId: string },
  ): Promise<void>;
  /**
   * Restores a folder subtree and its files in one atomic step. When `reparent` is
   * given, the subtree root is moved under that parent in the same step.
   *
   * Scoped to `userId`, for the same reason as `trashSubtree`.
   */
  restoreSubtree(
    userId: string,
    folderIds: string[],
    fileIds: string[],
    options: { rootId: string; reparent: { parentId: string | null } | null },
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
  /** Opaque OCE1 metadata for the first version; omitted = plaintext. */
  encryptionFormat?: string | null;
  wrappedKey?: string | null;
  metadataBlob?: string | null;
  keyEpoch?: number | null;
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

/** Opaque OCE1 encryption metadata. Null fields mean plaintext for that slot. */
export interface FileEncryptionFields {
  encryptionFormat: string | null;
  wrappedKey: string | null;
  metadataBlob: string | null;
  keyEpoch: number | null;
}

/** The content of one file version. The owning file id is supplied by the caller. */
export interface FileVersionInput {
  userId: string;
  size: number;
  mimeType: string;
  sha256: string;
  telegramMessageId: number;
  /** Opaque OCE1 metadata for this version; omitted = plaintext. */
  encryptionFormat?: string | null;
  wrappedKey?: string | null;
  metadataBlob?: string | null;
  keyEpoch?: number | null;
}

export interface FileRepository {
  create(input: FileCreateInput): Promise<FileRecord>;
  /**
   * Creates a file and its first version in one atomic write. Either both exist
   * afterwards, or neither does.
   */
  createWithFirstVersion(
    input: FileCreateInput & { version: FileVersionInput },
  ): Promise<FileRecord>;
  /**
   * Adds a version to a file and makes it current, with the file's counters, in
   * one atomic write. Either the file and its version both change, or neither does.
   */
  replaceWithVersion(
    fileId: string,
    input: {
      name: string;
      size: number;
      mimeType: string;
      sha256: string;
      telegramMessageId: number;
      /** Always applies: nulls clear encryption so a plaintext replace wins. */
      encryptionFormat: string | null;
      wrappedKey: string | null;
      metadataBlob: string | null;
      keyEpoch: number | null;
      version: FileVersionInput;
    },
  ): Promise<FileRecord>;
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
      /**
       * Encryption fields of the current version. Set together when a restore
       * makes an older version current again, so the file always describes the
       * version it points at.
       */
      encryptionFormat?: string | null;
      wrappedKey?: string | null;
      metadataBlob?: string | null;
      keyEpoch?: number | null;
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
  /**
   * Creates a version row and makes it the file's current version.
   *
   * The version number is allocated atomically, so concurrent creations cannot
   * collide, and the parent file's current-version fields are written in the
   * same transaction as the row.
   */
  createVersion(input: FileVersionInput & { fileId: string }): Promise<FileVersionRecord>;
  listVersions(fileId: string): Promise<FileVersionRecord[]>;
  /** All versions for many files in one query, grouped by file id. */
  listVersionsForFiles(fileIds: string[]): Promise<Map<string, FileVersionRecord[]>>;
  findVersionById(versionId: string): Promise<FileVersionRecord | null>;
  countVersions(fileId: string): Promise<number>;
  deleteVersionsByFileIds(fileIds: string[]): Promise<void>;
  /**
   * Replaces a version's encrypted metadata blob.
   *
   * The blob is opaque to the server: it is written by the client, which
   * re-encrypts the metadata when the file is renamed.
   */
  updateVersionMetadata(versionId: string, metadataBlob: string): Promise<void>;
  /**
   * Removes one historical version of a file and decrements the file's version
   * count.
   *
   * The delete and the count move together, so two concurrent deletes cannot
   * both read the same count and write the same decremented value. The current
   * version is refused: the file would have nothing left to point at.
   */
  deleteVersion(fileId: string, versionId: string): Promise<void>;
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
  apiTokens: ApiTokenRepository;
  uploadOperations: UploadOperationRepository;
  storages: StorageRepository;
  folders: FolderRepository;
  files: FileRepository;
  activity: ActivityRepository;
}
