import type { AppConfig } from "./config";
import {
  ActivityService,
  FileService,
  FolderService,
  IntegrityService,
  RecentService,
  SearchService,
  StatsService,
  StorageEngine,
  StorageNotInitializedError,
  TrashService,
} from "@omnicloud/core";
import type {
  EngineResolver,
  Repos,
  StorageHealth,
  StorageRecord,
  UserRecord,
} from "@omnicloud/core";
import {
  TELEGRAM_PROVIDER,
  TelegramClientManager,
  TelegramConnectionService,
  TelegramStorageProvider,
} from "@omnicloud/telegram";
import { createPrismaClient, createPrismaRepos } from "@omnicloud/database";
import { AuthSessionService, ReconciliationService, SecretBox, deriveKey } from "@omnicloud/core";

/**
 * The dependency-injection container: wires the Telegram connection manager,
 * the per-user storage engine, and the v0.2 domain services together.
 */

/** The subset of the Telegram connection service the API depends on. */
export interface ConnectionService {
  startLogin(phone: string): Promise<void>;
  verifyCode(
    phone: string,
    code: string,
  ): Promise<{ status: "ok"; user: UserRecord } | { status: "password_required" }>;
  verifyPassword(
    phone: string,
    password: string,
  ): Promise<{ status: "ok"; user: UserRecord } | { status: "password_required" }>;
  ensureStorage(userId: string): Promise<StorageRecord>;
}

export interface StorageHealthService {
  /** Connection state + storage probe for a user. */
  health(userId: string, deep?: boolean): Promise<StorageHealth & { state: string }>;
  /** Drops a user's Telegram connection (logout / reconnect). */
  disconnect(userId: string): Promise<void>;
}

export interface Container {
  config: AppConfig;
  repos: Repos;
  connection: ConnectionService;
  storageHealth: StorageHealthService;
  files: FileService;
  folders: FolderService;
  search: SearchService;
  stats: StatsService;
  trash: TrashService;
  recent: RecentService;
  activity: ActivityService;
  integrity: IntegrityService;
  /** Read-only comparison of the storage channel with the database. */
  reconciliation: ReconciliationService;
  /** Browser sign-in sessions: issue, resolve and revoke. */
  authSessions: AuthSessionService;
  /** Resolves the StorageEngine for a user (their own Telegram channel). */
  engineFor: EngineResolver;
  shutdown(): Promise<void>;
}

export function buildContainer(config: AppConfig): Container {
  const prisma = createPrismaClient();
  const box = config.encryptionKey
    ? new SecretBox([{ version: 1, key: deriveKey(config.encryptionKey) }])
    : null;
  const repos = createPrismaRepos(prisma, box);
  return buildContainerFromRepos(config, repos, {
    dispose: () => prisma.$disconnect(),
  });
}

export function buildContainerFromRepos(
  config: AppConfig,
  repos: Repos,
  overrides: {
    connection?: ConnectionService;
    engineFor?: EngineResolver;
    storageHealth?: StorageHealthService;
    dispose?: () => Promise<void>;
  } = {},
): Container {
  const credentials = {
    apiId: config.telegramApiId,
    apiHash: config.telegramApiHash,
  };

  const clientManager = new TelegramClientManager(credentials, repos.sessions);
  const connection =
    overrides.connection ?? new TelegramConnectionService(repos, clientManager, credentials);

  const engineCache = new Map<string, Promise<StorageEngine>>();

  const defaultEngineFor: EngineResolver = async (userId) => {
    const cached = engineCache.get(userId);
    if (cached) {
      try {
        return await cached;
      } catch {
        engineCache.delete(userId);
      }
    }
    const promise = (async () => {
      const storage = await repos.storages.findByUserAndProvider(userId, TELEGRAM_PROVIDER);
      if (!storage) throw new StorageNotInitializedError();
      const client = await clientManager.getForUser(userId);
      return new StorageEngine(
        new TelegramStorageProvider(client, {
          chatId: storage.telegramChatId,
          accessHash: storage.telegramAccessHash,
          title: storage.title,
        }),
      );
    })();
    engineCache.set(userId, promise);
    try {
      return await promise;
    } catch (error) {
      engineCache.delete(userId);
      throw error;
    }
  };

  const engineFor = overrides.engineFor ?? defaultEngineFor;

  const defaultStorageHealth: StorageHealthService = {
    async health(userId, deep = false) {
      const status = clientManager.statusForUser(userId);
      const storage = await repos.storages.findByUserAndProvider(userId, TELEGRAM_PROVIDER);
      if (!storage) {
        return {
          healthy: false,
          latencyMs: null,
          message: "Storage is not initialized",
          targetTitle: null,
          state: "DISCONNECTED",
        };
      }
      const probe = await clientManager.healthCheck(userId, deep);
      return {
        ...probe,
        targetTitle: probe.targetTitle ?? storage.title,
        state: clientManager.statusForUser(userId).state || status.state,
      };
    },
    async disconnect(userId) {
      await clientManager.disconnectUser(userId);
    },
  };

  const activity = new ActivityService(repos.activity);

  return {
    config,
    repos,
    connection,
    storageHealth: overrides.storageHealth ?? defaultStorageHealth,
    files: new FileService(repos.files, repos.folders, engineFor, activity, repos.uploadOperations),
    folders: new FolderService(repos.folders, repos.files, engineFor, activity),
    search: new SearchService(repos.files, repos.folders),
    stats: new StatsService(repos.files, repos.folders),
    trash: new TrashService(repos.files, repos.folders, engineFor),
    recent: new RecentService(repos.activity, repos.files),
    activity,
    integrity: new IntegrityService(repos.files, engineFor),
    reconciliation: new ReconciliationService(repos, engineFor),
    authSessions: new AuthSessionService(repos.browserSessions),
    engineFor,
    shutdown: async () => {
      await clientManager.disconnectAll();
      await overrides.dispose?.();
    },
  };
}
