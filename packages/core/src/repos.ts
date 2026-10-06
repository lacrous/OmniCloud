import type {
  FileRecord,
  FolderRecord,
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

export interface FolderRepository {
  create(input: { userId: string; parentId: string | null; name: string }): Promise<FolderRecord>;
  findById(id: string): Promise<FolderRecord | null>;
  /** Every folder belonging to the user (used for trees and cascade deletes). */
  listByUser(userId: string): Promise<FolderRecord[]>;
  listChildren(userId: string, parentId: string | null): Promise<FolderRecord[]>;
  update(id: string, patch: { name?: string; parentId?: string | null }): Promise<FolderRecord>;
  deleteMany(ids: string[]): Promise<void>;
  searchByName(userId: string, query: string, limit: number): Promise<FolderRecord[]>;
}

export interface FileRepository {
  create(input: {
    userId: string;
    folderId: string | null;
    name: string;
    size: number;
    mimeType: string;
    sha256: string;
    telegramMessageId: number;
  }): Promise<FileRecord>;
  findById(id: string): Promise<FileRecord | null>;
  listByFolder(userId: string, folderId: string | null): Promise<FileRecord[]>;
  listByUser(userId: string): Promise<FileRecord[]>;
  update(id: string, patch: { name?: string; folderId?: string | null }): Promise<FileRecord>;
  deleteMany(ids: string[]): Promise<void>;
  searchByName(userId: string, query: string, limit: number): Promise<FileRecord[]>;
}

export interface Repos {
  users: UserRepository;
  sessions: SessionRepository;
  storages: StorageRepository;
  folders: FolderRepository;
  files: FileRepository;
}
