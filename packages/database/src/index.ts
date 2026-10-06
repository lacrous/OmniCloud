import { PrismaClient, type File as DbFile, type Folder as DbFolder } from "@prisma/client";
import type {
  FileRecord,
  FileRepository,
  FolderRecord,
  FolderRepository,
  Repos,
  SessionRepository,
  StorageRecord,
  StorageRepository,
  TelegramSessionRecord,
  UserRepository,
} from "@omnicloud/core";

export { PrismaClient } from "@prisma/client";

export function createPrismaClient(): PrismaClient {
  return new PrismaClient();
}

type DbUser = {
  id: string;
  telegramUserId: bigint;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  createdAt: Date;
};

function mapUser(user: DbUser) {
  return {
    id: user.id,
    telegramUserId: user.telegramUserId.toString(),
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    createdAt: user.createdAt,
  };
}

function mapStorage(storage: {
  id: string;
  userId: string;
  provider: string;
  title: string;
  telegramChatId: bigint;
  telegramAccessHash: bigint;
  createdAt: Date;
}): StorageRecord {
  return {
    id: storage.id,
    userId: storage.userId,
    provider: storage.provider,
    title: storage.title,
    telegramChatId: storage.telegramChatId.toString(),
    telegramAccessHash: storage.telegramAccessHash.toString(),
    createdAt: storage.createdAt,
  };
}

function mapFolder(folder: DbFolder): FolderRecord {
  return {
    id: folder.id,
    userId: folder.userId,
    parentId: folder.parentId,
    name: folder.name,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
  };
}

function mapFile(file: DbFile): FileRecord {
  return {
    id: file.id,
    userId: file.userId,
    folderId: file.folderId,
    name: file.name,
    size: Number(file.size),
    mimeType: file.mimeType,
    sha256: file.sha256,
    telegramMessageId: Number(file.telegramMessageId),
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}

function createUserRepo(prisma: PrismaClient): UserRepository {
  return {
    async findById(id) {
      const user = await prisma.user.findUnique({ where: { id } });
      return user ? mapUser(user) : null;
    },
    async findByTelegramId(telegramUserId) {
      const user = await prisma.user.findUnique({
        where: { telegramUserId: BigInt(telegramUserId) },
      });
      return user ? mapUser(user) : null;
    },
    async upsertFromTelegram(input) {
      const data = {
        username: input.username,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
      };
      const user = await prisma.user.upsert({
        where: { telegramUserId: BigInt(input.telegramUserId) },
        update: data,
        create: { telegramUserId: BigInt(input.telegramUserId), ...data },
      });
      return mapUser(user);
    },
  };
}

function createSessionRepo(prisma: PrismaClient): SessionRepository {
  return {
    async get(userId) {
      const session = await prisma.telegramSession.findUnique({ where: { userId } });
      if (!session) return null;
      const record: TelegramSessionRecord = {
        userId: session.userId,
        stringSession: session.stringSession,
      };
      return record;
    },
    async save(userId, stringSession) {
      await prisma.telegramSession.upsert({
        where: { userId },
        update: { stringSession },
        create: { userId, stringSession },
      });
    },
    async delete(userId) {
      await prisma.telegramSession.deleteMany({ where: { userId } });
    },
  };
}

function createStorageRepo(prisma: PrismaClient): StorageRepository {
  return {
    async findByUserAndProvider(userId, provider) {
      const storage = await prisma.storage.findUnique({
        where: { userId_provider: { userId, provider } },
      });
      return storage ? mapStorage(storage) : null;
    },
    async create(input) {
      const storage = await prisma.storage.create({
        data: {
          userId: input.userId,
          provider: input.provider,
          title: input.title,
          telegramChatId: BigInt(input.telegramChatId),
          telegramAccessHash: BigInt(input.telegramAccessHash),
        },
      });
      return mapStorage(storage);
    },
  };
}

function createFolderRepo(prisma: PrismaClient): FolderRepository {
  return {
    async create(input) {
      const folder = await prisma.folder.create({
        data: { userId: input.userId, parentId: input.parentId, name: input.name },
      });
      return mapFolder(folder);
    },
    async findById(id) {
      const folder = await prisma.folder.findUnique({ where: { id } });
      return folder ? mapFolder(folder) : null;
    },
    async listByUser(userId) {
      const rows = await prisma.folder.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
      });
      return rows.map(mapFolder);
    },
    async listChildren(userId, parentId) {
      const rows = await prisma.folder.findMany({
        where: { userId, parentId },
        orderBy: [{ name: "asc" }, { createdAt: "asc" }],
      });
      return rows.map(mapFolder);
    },
    async update(id, patch) {
      const folder = await prisma.folder.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.parentId !== undefined ? { parentId: patch.parentId } : {}),
        },
      });
      return mapFolder(folder);
    },
    async deleteMany(ids) {
      await prisma.folder.deleteMany({ where: { id: { in: ids } } });
    },
    async searchByName(userId, query, limit) {
      const rows = await prisma.folder.findMany({
        where: { userId, name: { contains: query, mode: "insensitive" } },
        orderBy: { name: "asc" },
        take: limit,
      });
      return rows.map(mapFolder);
    },
  };
}

function createFileRepo(prisma: PrismaClient): FileRepository {
  return {
    async create(input) {
      const file = await prisma.file.create({
        data: {
          userId: input.userId,
          folderId: input.folderId,
          name: input.name,
          size: BigInt(input.size),
          mimeType: input.mimeType,
          sha256: input.sha256,
          telegramMessageId: BigInt(input.telegramMessageId),
        },
      });
      return mapFile(file);
    },
    async findById(id) {
      const file = await prisma.file.findUnique({ where: { id } });
      return file ? mapFile(file) : null;
    },
    async listByFolder(userId, folderId) {
      const rows = await prisma.file.findMany({
        where: { userId, folderId },
        orderBy: [{ name: "asc" }, { createdAt: "asc" }],
      });
      return rows.map(mapFile);
    },
    async listByUser(userId) {
      const rows = await prisma.file.findMany({ where: { userId } });
      return rows.map(mapFile);
    },
    async update(id, patch) {
      const file = await prisma.file.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.folderId !== undefined ? { folderId: patch.folderId } : {}),
        },
      });
      return mapFile(file);
    },
    async deleteMany(ids) {
      await prisma.file.deleteMany({ where: { id: { in: ids } } });
    },
    async searchByName(userId, query, limit) {
      const rows = await prisma.file.findMany({
        where: { userId, name: { contains: query, mode: "insensitive" } },
        orderBy: { name: "asc" },
        take: limit,
      });
      return rows.map(mapFile);
    },
  };
}

/**
 * Creates the Prisma-backed implementation of the core repository
 * interfaces. Requires `prisma generate` to have been run.
 */
export function createPrismaRepos(prisma: PrismaClient): Repos {
  return {
    users: createUserRepo(prisma),
    sessions: createSessionRepo(prisma),
    storages: createStorageRepo(prisma),
    folders: createFolderRepo(prisma),
    files: createFileRepo(prisma),
  };
}
