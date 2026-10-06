/**
 * Domain records. Repository implementations (e.g. the Prisma layer) map
 * their persistence models onto these records; the rest of the application
 * only ever works with them.
 *
 * Telegram identifiers are represented as strings/numbers that fit in
 * JavaScript's safe integer range; the persistence layer converts as needed.
 */

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
  createdAt: Date;
  updatedAt: Date;
}
