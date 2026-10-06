import type {
  FileRecord,
  FileRepository,
  FolderRecord,
  FolderRepository,
  Repos,
  SessionRepository,
  StorageRecord,
  StorageRepository,
  StorageProvider,
  StorageUploadInput,
  StoredObject,
  TelegramSessionRecord,
  UserRecord,
  UserRepository,
} from "../src/index";

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

export function createInMemoryRepos(): Repos & {
  users: UserRepository;
  _users: UserRecord[];
  _folders: FolderRecord[];
  _files: FileRecord[];
  _storages: StorageRecord[];
} {
  const users: UserRecord[] = [];
  const sessions: TelegramSessionRecord[] = [];
  const storages: StorageRecord[] = [];
  const folders: FolderRecord[] = [];
  const files: FileRecord[] = [];

  const now = () => new Date();

  const usersRepo: UserRepository = {
    findById: async (id) => users.find((u) => u.id === id) ?? null,
    findByTelegramId: async (tid) => users.find((u) => u.telegramUserId === tid) ?? null,
    upsertFromTelegram: async (input) => {
      const existing = users.find((u) => u.telegramUserId === input.telegramUserId);
      if (existing) {
        existing.username = input.username;
        existing.firstName = input.firstName;
        existing.lastName = input.lastName;
        existing.phone = input.phone;
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
      folders.filter((f) => f.userId === userId && f.parentId === parentId),
    update: async (id, patch) => {
      const folder = folders.find((f) => f.id === id);
      if (!folder) throw new Error("folder not found in fake repo");
      if (patch.name !== undefined) folder.name = patch.name;
      if (patch.parentId !== undefined) folder.parentId = patch.parentId;
      folder.updatedAt = now();
      return folder;
    },
    deleteMany: async (ids) => {
      for (const id of ids) {
        const idx = folders.findIndex((f) => f.id === id);
        if (idx >= 0) folders.splice(idx, 1);
      }
    },
    searchByName: async (userId, query, limit) =>
      folders
        .filter((f) => f.userId === userId && f.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, limit),
  };

  const filesRepo: FileRepository = {
    create: async (input) => {
      const record: FileRecord = {
        id: nextId("file"),
        createdAt: now(),
        updatedAt: now(),
        ...input,
      };
      files.push(record);
      return record;
    },
    findById: async (id) => files.find((f) => f.id === id) ?? null,
    listByFolder: async (userId, folderId) =>
      files.filter((f) => f.userId === userId && f.folderId === folderId),
    listByUser: async (userId) => files.filter((f) => f.userId === userId),
    update: async (id, patch) => {
      const file = files.find((f) => f.id === id);
      if (!file) throw new Error("file not found in fake repo");
      if (patch.name !== undefined) file.name = patch.name;
      if (patch.folderId !== undefined) file.folderId = patch.folderId;
      file.updatedAt = now();
      return file;
    },
    deleteMany: async (ids) => {
      for (const id of ids) {
        const idx = files.findIndex((f) => f.id === id);
        if (idx >= 0) files.splice(idx, 1);
      }
    },
    searchByName: async (userId, query, limit) =>
      files
        .filter((f) => f.userId === userId && f.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, limit),
  };

  return {
    users: usersRepo,
    sessions: sessionsRepo,
    storages: storagesRepo,
    folders: foldersRepo,
    files: filesRepo,
    _users: users,
    _folders: folders,
    _files: files,
    _storages: storages,
  };
}

/** Minimal in-memory StorageProvider used instead of Telegram in tests. */
export class FakeStorageProvider implements StorageProvider {
  readonly name = "fake";
  private counter = 0;
  readonly objects = new Map<string, { name: string; mimeType: string; data: Buffer }>();
  failNextPut = false;

  async put(input: StorageUploadInput): Promise<StoredObject> {
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error("simulated provider failure");
    }
    this.counter += 1;
    // Telegram message ids are integers — keep the fake realistic since the
    // domain layer coerces message ids to numbers.
    const messageId = String(this.counter);
    this.objects.set(messageId, { name: input.name, mimeType: input.mimeType, data: input.data });
    return {
      messageId,
      name: input.name,
      size: input.data.byteLength,
      mimeType: input.mimeType,
    };
  }

  async get(ref: { messageId: string }): Promise<Buffer> {
    const object = this.objects.get(ref.messageId);
    if (!object) throw new Error("object not found");
    return object.data;
  }

  async delete(ref: { messageId: string }): Promise<void> {
    this.objects.delete(ref.messageId);
  }

  async exists(ref: { messageId: string }): Promise<boolean> {
    return this.objects.has(ref.messageId);
  }

  async stat(ref: { messageId: string }): Promise<StoredObject | null> {
    const object = this.objects.get(ref.messageId);
    if (!object) return null;
    return {
      messageId: ref.messageId,
      name: object.name,
      size: object.data.byteLength,
      mimeType: object.mimeType,
    };
  }
}
