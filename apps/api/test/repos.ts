import { Readable } from "node:stream";
import type {
  ActivityEventRecord,
  ActivityRepository,
  FileRecord,
  FileRepository,
  FileVersionRecord,
  FolderRecord,
  FolderRepository,
  ItemQuery,
  PageRequest,
  Paged,
  Repos,
  SessionRepository,
  StorageProvider,
  StorageRecord,
  StorageRepository,
  StorageUploadInput,
  StoredObject,
  StoredRef,
  TelegramSessionRecord,
  TransferControl,
  UserRecord,
  UserRepository,
} from "@omnicloud/core";

let counter = 0;
export function nextId(prefix = "id"): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function makeUser(telegramUserId = "100"): UserRecord {
  return {
    id: nextId("user"),
    telegramUserId,
    username: "tester",
    firstName: "Test",
    lastName: "User",
    phone: "+10000000000",
    createdAt: new Date(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory repositories
// ─────────────────────────────────────────────────────────────────────────────

function matchMime(mimeType: string, matchers: readonly string[]): boolean {
  return matchers.some((matcher) =>
    matcher.endsWith("/") ? mimeType.startsWith(matcher) : mimeType === matcher,
  );
}

function isTrashed(deletedAt: Date | null, filter: boolean | undefined): boolean {
  if (filter === undefined) return true;
  return filter ? deletedAt !== null : deletedAt === null;
}

/** Applies an ItemQuery to folders in memory (mirrors the Prisma semantics). */
function filterFolders(userId: string, all: FolderRecord[], query: ItemQuery): FolderRecord[] {
  let rows = all.filter((folder) => folder.userId === userId);
  rows = rows.filter((folder) => isTrashed(folder.deletedAt, query.trashed));
  if (query.folderIds) {
    const allowed = new Set(query.folderIds);
    rows = rows.filter((folder) => allowed.has(folder.parentId ?? ""));
  } else if (query.folderId !== undefined) {
    rows = rows.filter((folder) => folder.parentId === query.folderId);
  }
  if (query.nameContains) {
    const needle = query.nameContains.toLowerCase();
    rows = rows.filter((folder) => folder.name.toLowerCase().includes(needle));
  }
  if (query.starred !== undefined) rows = rows.filter((folder) => folder.starred === query.starred);
  if (query.from) {
    const from = query.from;
    rows = rows.filter((folder) => folder.createdAt >= from);
  }
  if (query.to) {
    const to = query.to;
    rows = rows.filter((folder) => folder.createdAt <= to);
  }
  return sortRows(rows, query);
}

function filterFiles(userId: string, all: FileRecord[], query: ItemQuery): FileRecord[] {
  let rows = all.filter((file) => file.userId === userId);
  rows = rows.filter((file) => isTrashed(file.deletedAt, query.trashed));
  if (query.folderIds) {
    const allowed = new Set(query.folderIds);
    rows = rows.filter((file) => file.folderId !== null && allowed.has(file.folderId));
  } else if (query.folderId !== undefined) {
    rows = rows.filter((file) => file.folderId === query.folderId);
  }
  if (query.nameContains) {
    const needle = query.nameContains.toLowerCase();
    rows = rows.filter((file) => file.name.toLowerCase().includes(needle));
  }
  if (query.ext) {
    const suffix = `.${query.ext.toLowerCase()}`;
    rows = rows.filter((file) => file.name.toLowerCase().endsWith(suffix));
  }
  if (query.mimeMatchers) {
    const matchers = query.mimeMatchers;
    rows = rows.filter((file) => matchMime(file.mimeType, matchers));
  }
  if (query.starred !== undefined) rows = rows.filter((file) => file.starred === query.starred);
  if (query.minSize !== undefined) {
    const min = query.minSize;
    rows = rows.filter((file) => file.size >= min);
  }
  if (query.maxSize !== undefined) {
    const max = query.maxSize;
    rows = rows.filter((file) => file.size <= max);
  }
  if (query.from) {
    const from = query.from;
    rows = rows.filter((file) => file.createdAt >= from);
  }
  if (query.to) {
    const to = query.to;
    rows = rows.filter((file) => file.createdAt <= to);
  }
  return sortRows(rows, query);
}

interface Sortable {
  name: string;
  createdAt: Date;
  updatedAt: Date;
  size?: number;
  mimeType?: string;
}

function sortRows<T extends Sortable>(rows: T[], query: ItemQuery): T[] {
  const direction = query.order === "desc" ? -1 : 1;
  const sorted = [...rows];
  sorted.sort((a, b) => {
    switch (query.sort) {
      case "size":
        return ((a.size ?? 0) - (b.size ?? 0)) * direction;
      case "createdAt":
        return (a.createdAt.getTime() - b.createdAt.getTime()) * direction;
      case "updatedAt":
        return (a.updatedAt.getTime() - b.updatedAt.getTime()) * direction;
      case "type":
        return (a.mimeType ?? "").localeCompare(b.mimeType ?? "") * direction;
      case "name":
      default:
        return a.name.localeCompare(b.name) * direction;
    }
  });
  return sorted;
}

function paginate<T>(rows: T[], page: PageRequest): Paged<T> {
  const start = (page.page - 1) * page.limit;
  return { items: rows.slice(start, start + page.limit), total: rows.length };
}

export interface InMemoryRepos extends Repos {
  _users: UserRecord[];
  _folders: FolderRecord[];
  _files: FileRecord[];
  _versions: FileVersionRecord[];
  _storages: StorageRecord[];
  _activity: ActivityEventRecord[];
}

export function createInMemoryRepos(): InMemoryRepos {
  const users: UserRecord[] = [];
  const sessions: TelegramSessionRecord[] = [];
  const storages: StorageRecord[] = [];
  const folders: FolderRecord[] = [];
  const files: FileRecord[] = [];
  const versions: FileVersionRecord[] = [];
  const activity: ActivityEventRecord[] = [];
  const now = () => new Date();

  const usersRepo: UserRepository = {
    findById: async (id) => users.find((u) => u.id === id) ?? null,
    findByTelegramId: async (tid) => users.find((u) => u.telegramUserId === tid) ?? null,
    upsertFromTelegram: async (input) => {
      const existing = users.find((u) => u.telegramUserId === input.telegramUserId);
      if (existing) {
        Object.assign(existing, {
          username: input.username,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
        });
        return existing;
      }
      const record: UserRecord = { id: nextId("user"), createdAt: now(), ...input };
      users.push(record);
      return record;
    },
  };

  const sessionsRepo: SessionRepository = {
    get: async (userId) => sessions.find((s) => s.userId === userId) ?? null,
    save: async (userId, stringSession) => {
      const existing = sessions.find((s) => s.userId === userId);
      if (existing) existing.stringSession = stringSession;
      else sessions.push({ userId, stringSession });
    },
    delete: async (userId) => {
      const idx = sessions.findIndex((s) => s.userId === userId);
      if (idx >= 0) sessions.splice(idx, 1);
    },
  };

  const storagesRepo: StorageRepository = {
    findByUserAndProvider: async (userId, provider) =>
      storages.find((s) => s.userId === userId && s.provider === provider) ?? null,
    create: async (input) => {
      const record: StorageRecord = { id: nextId("storage"), createdAt: now(), ...input };
      storages.push(record);
      return record;
    },
  };

  const foldersRepo: FolderRepository = {
    create: async (input) => {
      const record: FolderRecord = {
        id: nextId("folder"),
        starred: false,
        deletedAt: null,
        trashBatchId: null,
        createdAt: now(),
        updatedAt: now(),
        ...input,
      };
      folders.push(record);
      return record;
    },
    findById: async (id) => folders.find((f) => f.id === id) ?? null,
    listByUser: async (userId) => folders.filter((f) => f.userId === userId),
    listChildren: async (userId, parentId) =>
      folders.filter((f) => f.userId === userId && f.parentId === parentId && f.deletedAt === null),
    query: async (userId, query, page) => paginate(filterFolders(userId, folders, query), page),
    findIdsByName: async (userId, name) =>
      folders
        .filter(
          (f) =>
            f.userId === userId &&
            f.deletedAt === null &&
            f.name.toLowerCase().includes(name.toLowerCase()),
        )
        .map((f) => f.id),
    update: async (id, patch) => {
      const folder = folders.find((f) => f.id === id);
      if (!folder) throw new Error("folder not found in fake repo");
      if (patch.name !== undefined) folder.name = patch.name;
      if (patch.parentId !== undefined) folder.parentId = patch.parentId;
      if (patch.starred !== undefined) folder.starred = patch.starred;
      if (patch.deletedAt !== undefined) folder.deletedAt = patch.deletedAt;
      if (patch.trashBatchId !== undefined) folder.trashBatchId = patch.trashBatchId;
      folder.updatedAt = now();
      return folder;
    },
    updateMany: async (ids, patch) => {
      let count = 0;
      for (const id of ids) {
        const folder = folders.find((f) => f.id === id);
        if (!folder) continue;
        if (patch.starred !== undefined) folder.starred = patch.starred;
        if (patch.deletedAt !== undefined) folder.deletedAt = patch.deletedAt;
        if (patch.trashBatchId !== undefined) folder.trashBatchId = patch.trashBatchId;
        folder.updatedAt = now();
        count += 1;
      }
      return count;
    },
    deleteMany: async (ids) => {
      for (const id of ids) {
        const idx = folders.findIndex((f) => f.id === id);
        if (idx >= 0) folders.splice(idx, 1);
      }
    },
    countByUser: async (userId) =>
      folders.filter((f) => f.userId === userId && f.deletedAt === null).length,
  };

  const filesRepo: FileRepository = {
    create: async (input) => {
      const record: FileRecord = {
        id: nextId("file"),
        starred: false,
        deletedAt: null,
        trashBatchId: null,
        currentVersionId: null,
        versionCount: 0,
        createdAt: now(),
        updatedAt: now(),
        ...input,
      };
      files.push(record);
      return record;
    },
    findById: async (id) => files.find((f) => f.id === id) ?? null,
    listByFolder: async (userId, folderId) =>
      files.filter((f) => f.userId === userId && f.folderId === folderId && f.deletedAt === null),
    listByUser: async (userId) => files.filter((f) => f.userId === userId),
    listByIds: async (userId, ids) => {
      const allowed = new Set(ids);
      return files.filter((f) => f.userId === userId && allowed.has(f.id));
    },
    query: async (userId, query, page) => paginate(filterFiles(userId, files, query), page),
    update: async (id, patch) => {
      const file = files.find((f) => f.id === id);
      if (!file) throw new Error("file not found in fake repo");
      if (patch.name !== undefined) file.name = patch.name;
      if (patch.folderId !== undefined) file.folderId = patch.folderId;
      if (patch.starred !== undefined) file.starred = patch.starred;
      if (patch.deletedAt !== undefined) file.deletedAt = patch.deletedAt;
      if (patch.trashBatchId !== undefined) file.trashBatchId = patch.trashBatchId;
      if (patch.size !== undefined) file.size = patch.size;
      if (patch.mimeType !== undefined) file.mimeType = patch.mimeType;
      if (patch.sha256 !== undefined) file.sha256 = patch.sha256;
      if (patch.telegramMessageId !== undefined) file.telegramMessageId = patch.telegramMessageId;
      if (patch.currentVersionId !== undefined) file.currentVersionId = patch.currentVersionId;
      if (patch.versionCount !== undefined) file.versionCount = patch.versionCount;
      file.updatedAt = now();
      return file;
    },
    updateMany: async (ids, patch) => {
      let count = 0;
      for (const id of ids) {
        const file = files.find((f) => f.id === id);
        if (!file) continue;
        if (patch.folderId !== undefined) file.folderId = patch.folderId;
        if (patch.starred !== undefined) file.starred = patch.starred;
        if (patch.deletedAt !== undefined) file.deletedAt = patch.deletedAt;
        if (patch.trashBatchId !== undefined) file.trashBatchId = patch.trashBatchId;
        file.updatedAt = now();
        count += 1;
      }
      return count;
    },
    statsByUser: async (userId) => {
      const mine = files.filter((f) => f.userId === userId);
      const active = mine.filter((f) => f.deletedAt === null);
      const trashed = mine.filter((f) => f.deletedAt !== null);
      return {
        fileCount: active.length,
        folderCount: folders.filter((f) => f.userId === userId && f.deletedAt === null).length,
        totalBytes: active.reduce((sum, f) => sum + f.size, 0),
        trashBytes: trashed.reduce((sum, f) => sum + f.size, 0),
        trashFileCount: trashed.length,
        starredCount: active.filter((f) => f.starred).length,
      };
    },
    deleteMany: async (ids) => {
      for (const id of ids) {
        const idx = files.findIndex((f) => f.id === id);
        if (idx >= 0) files.splice(idx, 1);
      }
    },
    createVersion: async (input) => {
      const existing = versions.filter((v) => v.fileId === input.fileId);
      const record: FileVersionRecord = {
        id: nextId("version"),
        versionNumber: existing.length + 1,
        createdAt: now(),
        ...input,
      };
      versions.push(record);
      return record;
    },
    listVersions: async (fileId) =>
      versions.filter((v) => v.fileId === fileId).sort((a, b) => b.versionNumber - a.versionNumber),
    findVersionById: async (versionId) => versions.find((v) => v.id === versionId) ?? null,
    countVersions: async (fileId) => versions.filter((v) => v.fileId === fileId).length,
    deleteVersionsByFileIds: async (fileIds) => {
      const allowed = new Set(fileIds);
      for (let i = versions.length - 1; i >= 0; i -= 1) {
        if (allowed.has(versions[i]!.fileId)) versions.splice(i, 1);
      }
    },
  };

  const activityRepo: ActivityRepository = {
    record: async (input) => {
      activity.push({
        id: nextId("event"),
        resourceName: input.resourceName ?? null,
        metadata: input.metadata ?? null,
        createdAt: now(),
        userId: input.userId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
      });
    },
    list: async (userId, page) => {
      const rows = activity
        .filter((e) => e.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return paginate(rows, page);
    },
    recentFiles: async (userId, actions, limit) => {
      const allowed = new Set(actions);
      const rows = activity
        .filter((e) => e.userId === userId && e.resourceType === "file" && allowed.has(e.action))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const seen = new Set<string>();
      const result: ActivityEventRecord[] = [];
      for (const row of rows) {
        if (seen.has(row.resourceId)) continue;
        seen.add(row.resourceId);
        result.push(row);
      }
      return result.slice(0, limit);
    },
    countByUser: async (userId) => activity.filter((e) => e.userId === userId).length,
    pruneOlderThan: async (cutoff) => {
      let removed = 0;
      for (let i = activity.length - 1; i >= 0; i -= 1) {
        if (activity[i]!.createdAt < cutoff) {
          activity.splice(i, 1);
          removed += 1;
        }
      }
      return removed;
    },
  };

  return {
    users: usersRepo,
    sessions: sessionsRepo,
    storages: storagesRepo,
    folders: foldersRepo,
    files: filesRepo,
    activity: activityRepo,
    _users: users,
    _folders: folders,
    _files: files,
    _versions: versions,
    _storages: storages,
    _activity: activity,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fake storage provider (v0.2 interface)
// ─────────────────────────────────────────────────────────────────────────────

export class FakeStorageProvider implements StorageProvider {
  readonly name = "fake";
  private counter = 0;
  readonly objects = new Map<string, { name: string; mimeType: string; data: Buffer }>();
  failNextPut = false;
  /** When true, every upload fails. */
  failAllPuts = false;
  failNextGet = false;
  failNextDelete = false;
  /** When true, every delete fails (to exercise retry/guard behavior). */
  failAllDeletes = false;
  /** Number of transient failures to inject before succeeding. */
  transientPutFailures = 0;
  /** Milliseconds each operation sleeps, to exercise cancellation. */
  latencyMs = 0;
  healthResult: "healthy" | "unhealthy" = "healthy";
  putCalls = 0;
  lastProgress: number[] = [];

  private async pause(signal?: AbortSignal): Promise<void> {
    if (this.latencyMs <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, this.latencyMs);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        },
        { once: true },
      );
    });
  }

  async put(input: StorageUploadInput, control?: TransferControl): Promise<StoredObject> {
    this.putCalls += 1;
    await this.pause(control?.signal);
    if (this.failAllPuts) throw new Error("invalid upload (non-retryable)");
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error("simulated provider failure");
    }
    if (this.transientPutFailures > 0) {
      this.transientPutFailures -= 1;
      throw new Error("simulated transient failure");
    }
    const data = input.data ?? (await drain(input.stream));
    this.counter += 1;
    const messageId = String(this.counter);
    this.objects.set(messageId, { name: input.name, mimeType: input.mimeType, data });
    control?.onProgress?.({ transferred: data.byteLength, total: data.byteLength, percent: 100 });
    this.lastProgress.push(100);
    return { messageId, name: input.name, size: data.byteLength, mimeType: input.mimeType };
  }

  async get(ref: StoredRef, control?: TransferControl): Promise<Buffer> {
    await this.pause(control?.signal);
    if (this.failNextGet) {
      this.failNextGet = false;
      throw new Error("simulated download failure");
    }
    const object = this.objects.get(ref.messageId);
    if (!object) throw new Error("object not found");
    control?.onProgress?.({
      transferred: object.data.byteLength,
      total: object.data.byteLength,
      percent: 100,
    });
    return object.data;
  }

  async getStream(ref: StoredRef, control?: TransferControl): Promise<Readable> {
    const data = await this.get(ref, control);
    return Readable.from([data]);
  }

  async delete(ref: StoredRef): Promise<void> {
    if (this.failAllDeletes) throw new Error("simulated persistent delete failure");
    if (this.failNextDelete) {
      this.failNextDelete = false;
      throw new Error("simulated delete failure");
    }
    this.objects.delete(ref.messageId);
  }

  async exists(ref: StoredRef): Promise<boolean> {
    return this.objects.has(ref.messageId);
  }

  async stat(ref: StoredRef): Promise<StoredObject | null> {
    const object = this.objects.get(ref.messageId);
    if (!object) return null;
    return {
      messageId: ref.messageId,
      name: object.name,
      size: object.data.byteLength,
      mimeType: object.mimeType,
    };
  }

  async healthCheck() {
    return {
      healthy: this.healthResult === "healthy",
      latencyMs: 1,
      message: this.healthResult === "healthy" ? null : "simulated unhealthy",
      targetTitle: "Fake Storage",
    };
  }
}

async function drain(stream: Readable | undefined): Promise<Buffer> {
  if (!stream) throw new Error("no data and no stream");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}
