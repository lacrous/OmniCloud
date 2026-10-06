import type { AppConfig } from "./config";
import {
  FileService,
  FolderService,
  SearchService,
  StorageEngine,
  StorageNotInitializedError,
} from "@omnicloud/core";
import type { EngineResolver, Repos, StorageRecord, UserRecord } from "@omnicloud/core";
import {
  TELEGRAM_PROVIDER,
  TelegramClientManager,
  TelegramConnectionService,
  TelegramStorageProvider,
} from "@omnicloud/telegram";
import { createPrismaClient, createPrismaRepos } from "@omnicloud/database";

/**
 * The dependency-injection container: wires the Telegram connection, the
 * per-user storage engine, and the domain services together.
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

export interface Container {
  config: AppConfig;
  repos: Repos;
  connection: ConnectionService;
  files: FileService;
  folders: FolderService;
  search: SearchService;
  /** Resolves the StorageEngine for a user (their own Telegram channel). */
  engineFor: EngineResolver;
  shutdown(): Promise<void>;
}

export function buildContainer(config: AppConfig): Container {
  const prisma = createPrismaClient();
  const repos = createPrismaRepos(prisma);
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

  return {
    config,
    repos,
    connection,
    files: new FileService(repos.files, repos.folders, engineFor),
    folders: new FolderService(repos.folders, repos.files, engineFor),
    search: new SearchService(repos.files, repos.folders),
    engineFor,
    shutdown: async () => {
      await clientManager.disconnectAll();
      await overrides.dispose?.();
    },
  };
}
