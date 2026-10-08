import {
  PrismaClient,
  type Prisma,
  type File as DbFile,
  type Folder as DbFolder,
  type FileVersion as DbFileVersion,
  type ActivityEvent as DbActivityEvent,
} from "@prisma/client";
import type {
  ActivityEventRecord,
  ActivityRepository,
  ActivityAction,
  FileRecord,
  FileRepository,
  FileVersionRecord,
  FolderRecord,
  FolderRepository,
  ItemQuery,
  PageRequest,
  Repos,
  ResourceType,
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

// ─────────────────────────────────────────────────────────────────────────────
// Mappers
// ─────────────────────────────────────────────────────────────────────────────

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
    starred: folder.starred,
    deletedAt: folder.deletedAt,
    trashBatchId: folder.trashBatchId,
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
    starred: file.starred,
    deletedAt: file.deletedAt,
    trashBatchId: file.trashBatchId,
    currentVersionId: file.currentVersionId,
    versionCount: file.versionCount,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}

function mapVersion(version: DbFileVersion, _currentVersionId: string | null): FileVersionRecord {
  return {
    id: version.id,
    fileId: version.fileId,
    userId: version.userId,
    versionNumber: version.versionNumber,
    size: Number(version.size),
    mimeType: version.mimeType,
    sha256: version.sha256,
    telegramMessageId: Number(version.telegramMessageId),
    createdAt: version.createdAt,
  };
}

function mapActivity(event: DbActivityEvent): ActivityEventRecord {
  return {
    id: event.id,
    userId: event.userId,
    action: event.action as ActivityAction,
    resourceType: event.resourceType as ResourceType,
    resourceId: event.resourceId,
    resourceName: event.resourceName,
    metadata: (event.metadata as Record<string, unknown> | null) ?? null,
    createdAt: event.createdAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Query building
// ─────────────────────────────────────────────────────────────────────────────

/** Builds the Prisma `where` clause for a file query. */
function fileWhere(userId: string, query: ItemQuery): Prisma.FileWhereInput {
  const where: Prisma.FileWhereInput = { userId };

  if (query.trashed === true) where.deletedAt = { not: null };
  else if (query.trashed === false) where.deletedAt = null;

  if (query.folderIds) {
    where.folderId = { in: query.folderIds };
  } else if (query.folderId !== undefined) {
    where.folderId = query.folderId;
  }

  if (query.nameContains) {
    where.name = { contains: query.nameContains, mode: "insensitive" };
  }
  if (query.starred !== undefined) where.starred = query.starred;

  if (query.minSize !== undefined || query.maxSize !== undefined) {
    where.size = {};
    if (query.minSize !== undefined) where.size.gte = BigInt(query.minSize);
    if (query.maxSize !== undefined) where.size.lte = BigInt(query.maxSize);
  }

  if (query.from || query.to) {
    where.createdAt = {};
    if (query.from) where.createdAt.gte = query.from;
    if (query.to) where.createdAt.lte = query.to;
  }

  if (query.ext) {
    // Case-insensitive suffix match on the filename.
    where.name = { ...(where.name as object), endsWith: `.${query.ext}`, mode: "insensitive" };
  }

  if (query.mimeMatchers && query.mimeMatchers.length > 0) {
    where.OR = query.mimeMatchers.map((matcher) =>
      matcher.endsWith("/") ? { mimeType: { startsWith: matcher } } : { mimeType: matcher },
    );
  }

  return where;
}

/** Builds the Prisma `where` clause for a folder query. */
function folderWhere(userId: string, query: ItemQuery): Prisma.FolderWhereInput {
  const where: Prisma.FolderWhereInput = { userId };

  if (query.trashed === true) where.deletedAt = { not: null };
  else if (query.trashed === false) where.deletedAt = null;

  if (query.folderId !== undefined) where.parentId = query.folderId;
  if (query.nameContains) where.name = { contains: query.nameContains, mode: "insensitive" };
  if (query.starred !== undefined) where.starred = query.starred;

  if (query.from || query.to) {
    where.createdAt = {};
    if (query.from) where.createdAt.gte = query.from;
    if (query.to) where.createdAt.lte = query.to;
  }

  return where;
}

function fileOrderBy(query: ItemQuery): Prisma.FileOrderByWithRelationInput[] {
  const order = query.order ?? "asc";
  switch (query.sort) {
    case "size":
      return [{ size: order }];
    case "createdAt":
      return [{ createdAt: order }];
    case "updatedAt":
      return [{ updatedAt: order }];
    case "type":
      return [{ mimeType: order }, { name: "asc" }];
    case "name":
    default:
      return [{ name: order }, { createdAt: "asc" }];
  }
}

function folderOrderBy(query: ItemQuery): Prisma.FolderOrderByWithRelationInput[] {
  const order = query.order ?? "asc";
  switch (query.sort) {
    case "createdAt":
      return [{ createdAt: order }];
    case "updatedAt":
      return [{ updatedAt: order }];
    case "name":
    default:
      return [{ name: order }, { createdAt: "asc" }];
  }
}

function skipTake(page: PageRequest): { skip: number; take: number } {
  return { skip: (page.page - 1) * page.limit, take: page.limit };
}

// ─────────────────────────────────────────────────────────────────────────────
// Repositories
// ─────────────────────────────────────────────────────────────────────────────

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
        where: { userId, parentId, deletedAt: null },
        orderBy: [{ name: "asc" }, { createdAt: "asc" }],
      });
      return rows.map(mapFolder);
    },
    async query(userId, query, page) {
      const where = folderWhere(userId, query);
      const [rows, total] = await Promise.all([
        prisma.folder.findMany({
          where,
          orderBy: folderOrderBy(query),
          ...skipTake(page),
        }),
        prisma.folder.count({ where }),
      ]);
      return { items: rows.map(mapFolder), total };
    },
    async findIdsByName(userId, name) {
      const rows = await prisma.folder.findMany({
        where: { userId, name: { contains: name, mode: "insensitive" }, deletedAt: null },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },
    async update(id, patch) {
      const folder = await prisma.folder.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.parentId !== undefined ? { parentId: patch.parentId } : {}),
          ...(patch.starred !== undefined ? { starred: patch.starred } : {}),
          ...(patch.deletedAt !== undefined ? { deletedAt: patch.deletedAt } : {}),
          ...(patch.trashBatchId !== undefined ? { trashBatchId: patch.trashBatchId } : {}),
        },
      });
      return mapFolder(folder);
    },
    async updateMany(ids, patch) {
      const result = await prisma.folder.updateMany({
        where: { id: { in: ids } },
        data: {
          ...(patch.starred !== undefined ? { starred: patch.starred } : {}),
          ...(patch.deletedAt !== undefined ? { deletedAt: patch.deletedAt } : {}),
          ...(patch.trashBatchId !== undefined ? { trashBatchId: patch.trashBatchId } : {}),
        },
      });
      return result.count;
    },
    async deleteMany(ids) {
      // Children may reference parents; delete deepest-first via repeated passes.
      let remaining = [...ids];
      let guard = 0;
      while (remaining.length > 0 && guard < 100) {
        guard += 1;
        const withChildren = await prisma.folder.findMany({
          where: { parentId: { in: remaining } },
          select: { parentId: true },
        });
        const parentsWithChildren = new Set(
          withChildren.map((row) => row.parentId).filter((id): id is string => id !== null),
        );
        const leaves = remaining.filter((id) => !parentsWithChildren.has(id));
        if (leaves.length === 0) break;
        await prisma.folder.deleteMany({ where: { id: { in: leaves } } });
        remaining = remaining.filter((id) => !leaves.includes(id));
      }
      if (remaining.length > 0) {
        await prisma.folder.deleteMany({ where: { id: { in: remaining } } });
      }
    },
    async countByUser(userId) {
      return prisma.folder.count({ where: { userId, deletedAt: null } });
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
        where: { userId, folderId, deletedAt: null },
        orderBy: [{ name: "asc" }, { createdAt: "asc" }],
      });
      return rows.map(mapFile);
    },
    async listByUser(userId) {
      const rows = await prisma.file.findMany({ where: { userId } });
      return rows.map(mapFile);
    },
    async listByIds(userId, ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.file.findMany({ where: { userId, id: { in: ids } } });
      return rows.map(mapFile);
    },
    async query(userId, query, page) {
      const where = fileWhere(userId, query);
      const [rows, total] = await Promise.all([
        prisma.file.findMany({ where, orderBy: fileOrderBy(query), ...skipTake(page) }),
        prisma.file.count({ where }),
      ]);
      return { items: rows.map(mapFile), total };
    },
    async update(id, patch) {
      const file = await prisma.file.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.folderId !== undefined ? { folderId: patch.folderId } : {}),
          ...(patch.starred !== undefined ? { starred: patch.starred } : {}),
          ...(patch.deletedAt !== undefined ? { deletedAt: patch.deletedAt } : {}),
          ...(patch.trashBatchId !== undefined ? { trashBatchId: patch.trashBatchId } : {}),
          ...(patch.size !== undefined ? { size: BigInt(patch.size) } : {}),
          ...(patch.mimeType !== undefined ? { mimeType: patch.mimeType } : {}),
          ...(patch.sha256 !== undefined ? { sha256: patch.sha256 } : {}),
          ...(patch.telegramMessageId !== undefined
            ? { telegramMessageId: BigInt(patch.telegramMessageId) }
            : {}),
          ...(patch.currentVersionId !== undefined
            ? { currentVersionId: patch.currentVersionId }
            : {}),
          ...(patch.versionCount !== undefined ? { versionCount: patch.versionCount } : {}),
        },
      });
      return mapFile(file);
    },
    async updateMany(ids, patch) {
      const result = await prisma.file.updateMany({
        where: { id: { in: ids } },
        data: {
          ...(patch.folderId !== undefined ? { folderId: patch.folderId } : {}),
          ...(patch.starred !== undefined ? { starred: patch.starred } : {}),
          ...(patch.deletedAt !== undefined ? { deletedAt: patch.deletedAt } : {}),
          ...(patch.trashBatchId !== undefined ? { trashBatchId: patch.trashBatchId } : {}),
        },
      });
      return result.count;
    },
    async statsByUser(userId) {
      const [fileAgg, folderCount] = await Promise.all([
        prisma.file.groupBy({
          by: ["deletedAt"],
          where: { userId },
          _count: { _all: true },
          _sum: { size: true },
        }),
        prisma.folder.count({ where: { userId, deletedAt: null } }),
      ]);

      let fileCount = 0;
      let totalBytes = 0;
      let trashBytes = 0;
      let trashFileCount = 0;
      for (const group of fileAgg) {
        const count = group._count._all;
        const bytes = Number(group._sum.size ?? 0);
        if (group.deletedAt === null) {
          fileCount = count;
          totalBytes = bytes;
        } else {
          trashFileCount = count;
          trashBytes = bytes;
        }
      }

      const starredCount = await prisma.file.count({
        where: { userId, starred: true, deletedAt: null },
      });

      return { fileCount, folderCount, totalBytes, trashBytes, trashFileCount, starredCount };
    },
    async deleteMany(ids) {
      await prisma.file.deleteMany({ where: { id: { in: ids } } });
    },

    // ── Versions ───────────────────────────────────────────────────────────
    async createVersion(input) {
      const count = await prisma.fileVersion.count({ where: { fileId: input.fileId } });
      const version = await prisma.fileVersion.create({
        data: {
          fileId: input.fileId,
          userId: input.userId,
          versionNumber: count + 1,
          size: BigInt(input.size),
          mimeType: input.mimeType,
          sha256: input.sha256,
          telegramMessageId: BigInt(input.telegramMessageId),
        },
      });
      return mapVersion(version, null);
    },
    async listVersions(fileId) {
      const [rows, file] = await Promise.all([
        prisma.fileVersion.findMany({ where: { fileId }, orderBy: { versionNumber: "desc" } }),
        prisma.file.findUnique({ where: { id: fileId }, select: { currentVersionId: true } }),
      ]);
      const currentId = file?.currentVersionId ?? null;
      return rows.map((row) => mapVersion(row, currentId));
    },
    async findVersionById(versionId) {
      const version = await prisma.fileVersion.findUnique({ where: { id: versionId } });
      return version ? mapVersion(version, null) : null;
    },
    async countVersions(fileId) {
      return prisma.fileVersion.count({ where: { fileId } });
    },
    async deleteVersionsByFileIds(fileIds) {
      if (fileIds.length === 0) return;
      await prisma.fileVersion.deleteMany({ where: { fileId: { in: fileIds } } });
    },
  };
}

function createActivityRepo(prisma: PrismaClient): ActivityRepository {
  return {
    async record(input) {
      await prisma.activityEvent.create({
        data: {
          userId: input.userId,
          action: input.action,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          resourceName: input.resourceName ?? null,
          metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    },
    async list(userId, page) {
      const where = { userId };
      const [rows, total] = await Promise.all([
        prisma.activityEvent.findMany({
          where,
          orderBy: { createdAt: "desc" },
          ...skipTake(page),
        }),
        prisma.activityEvent.count({ where }),
      ]);
      return { items: rows.map(mapActivity), total };
    },
    async recentFiles(userId, actions, limit) {
      const rows = await prisma.activityEvent.findMany({
        where: { userId, resourceType: "file", action: { in: [...actions] } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      });
      const seen = new Set<string>();
      const result: ActivityEventRecord[] = [];
      for (const row of rows) {
        if (seen.has(row.resourceId)) continue;
        seen.add(row.resourceId);
        result.push(mapActivity(row));
      }
      return result;
    },
    async countByUser(userId) {
      return prisma.activityEvent.count({ where: { userId } });
    },
    async pruneOlderThan(cutoff) {
      const result = await prisma.activityEvent.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      return result.count;
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
    activity: createActivityRepo(prisma),
  };
}
