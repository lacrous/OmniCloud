/**
 * Domain records. Repository implementations (e.g. the Prisma layer) map
 * their persistence models onto these records; the rest of the application
 * only ever works with them.
 *
 * Telegram identifiers are represented as strings/numbers that fit in
 * JavaScript's safe integer range; the persistence layer converts as needed.
 */

import type { ActivityAction, ResourceType, SortField, SortOrder } from "@omnicloud/shared";

export interface UserRecord {
  id: string;
  telegramUserId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  createdAt: Date;
}

export interface TelegramSessionRecord {
  userId: string;
  stringSession: string;
}

export interface StorageRecord {
  id: string;
  userId: string;
  provider: string;
  title: string;
  telegramChatId: string;
  telegramAccessHash: string;
  createdAt: Date;
}

export interface FolderRecord {
  id: string;
  userId: string;
  parentId: string | null;
  name: string;
  starred: boolean;
  /** Soft-delete marker (null = active). */
  deletedAt: Date | null;
  /**
   * Groups everything moved to the Trash by one operation, so restoring a
   * folder restores exactly what it took (and leaves separately-trashed
   * items alone). Null for items trashed individually.
   */
  trashBatchId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FileRecord {
  id: string;
  userId: string;
  folderId: string | null;
  name: string;
  size: number;
  mimeType: string;
  sha256: string;
  telegramMessageId: number;
  starred: boolean;
  /** Soft-delete marker (null = active). */
  deletedAt: Date | null;
  /** See FolderRecord.trashBatchId. */
  trashBatchId: string | null;
  /** Current version row, if versioning has been initialized for this file. */
  currentVersionId: string | null;
  versionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface FileVersionRecord {
  id: string;
  fileId: string;
  userId: string;
  versionNumber: number;
  size: number;
  mimeType: string;
  sha256: string;
  telegramMessageId: number;
  createdAt: Date;
}

export interface ActivityEventRecord {
  id: string;
  userId: string;
  action: ActivityAction;
  resourceType: ResourceType;
  resourceId: string;
  resourceName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Query primitives handed to repositories
// ─────────────────────────────────────────────────────────────────────────────

/** Resolved, repository-ready item query (search parser output resolved). */
export interface ItemQuery {
  /** Restrict to a folder (null = root). Undefined = any folder. */
  folderId?: string | null;
  /** Restrict to a set of folder ids (used for `folder:Name` filters). */
  folderIds?: string[];
  nameContains?: string;
  /** MIME matchers: exact values or prefixes ending in "/". */
  mimeMatchers?: readonly string[];
  ext?: string;
  starred?: boolean;
  /** false = active only, true = trashed only, undefined = both. */
  trashed?: boolean;
  minSize?: number;
  maxSize?: number;
  from?: Date;
  to?: Date;
  sort?: SortField;
  order?: SortOrder;
}

export interface PageRequest {
  page: number;
  limit: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage statistics
// ─────────────────────────────────────────────────────────────────────────────

export interface FileTypeBucket {
  category: string;
  bytes: number;
  count: number;
}

export interface StorageStats {
  fileCount: number;
  folderCount: number;
  totalBytes: number;
  trashBytes: number;
  trashFileCount: number;
  starredCount: number;
  byType: FileTypeBucket[];
  largestFiles: FileRecord[];
  /** Optional quota ceiling (null = unlimited, the v0.2 default). */
  quotaBytes: number | null;
}
