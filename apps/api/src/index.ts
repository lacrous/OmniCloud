import { sweepStaleSpools, type OperationSink } from "@omnicloud/core";
import type { FastifyBaseLogger } from "fastify";
import { loadConfig } from "./config";
import { buildContainer } from "./container";
import { createApp } from "./app";
import { startUpdateChecker } from "./update-checker";
import { APP_VERSION } from "./version";

const config = loadConfig();
const operationLogTarget: { log: OperationSink | null } = { log: null };
const container = buildContainer(config, {
  operationLog: {
    info: (record, message) => operationLogTarget.log?.info(record, message),
    warn: (record, message) => operationLogTarget.log?.warn(record, message),
  },
});

// The update check is periodic and cached: the registry is contacted at most
// once an hour no matter how many browsers are open. The logger is held in a
// mutable holder because the checker starts before the Fastify app exists.
const appLogTarget: { log: FastifyBaseLogger | null } = { log: null };
const updateChecker = config.updateCheckEnabled
  ? startUpdateChecker({
      currentVersion: APP_VERSION,
      packageName: config.updatePackageName,
      onResult: (result) => {
        if (result.status === "update_available") {
          appLogTarget.log?.info(
            { current: result.currentVersion, latest: result.latestVersion },
            "A newer release is available",
          );
        } else if (result.status === "unknown") {
          appLogTarget.log?.warn({ detail: result.detail }, "Update check failed");
        }
      },
    })
  : null;

const app = await createApp(container, { updateChecker });
operationLogTarget.log = app.log;
appLogTarget.log = app.log;

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "Shutting down");
  updateChecker?.stop();
  await app.close();
  await container.shutdown();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  const staleSpools = await sweepStaleSpools().catch((error: unknown) => {
    app.log.warn({ err: error }, "Could not sweep stale upload spools");
    return 0;
  });
  if (staleSpools > 0)
    app.log.info({ staleSpools }, "Removed upload spools left by a stopped process");
  await app.listen({ port: config.port, host: config.host });

  const pruneSessions = () =>
    container.authSessions.pruneExpired().then(
      (removed) => {
        if (removed > 0) app.log.info({ removed }, "Pruned expired browser sessions");
      },
      (error: unknown) => app.log.warn({ err: error }, "Could not prune expired sessions"),
    );
  void pruneSessions();
  setInterval(pruneSessions, 60 * 60 * 1000).unref();

  // Run the first update check right away so the sidebar has data now rather
  // than after the first interval. A failure here is never fatal.
  void updateChecker?.check();

  // ── Trash retention ───────────────────────────────────────────────────────
  // Trashed items are kept for a configured number of days and then removed
  // for good, so the trash cannot grow without bound. The job is periodic and
  // tolerant: one user's failure never stops the others.
  const purgeTrash = async () => {
    const days = config.trashRetentionDays;
    if (days <= 0) return;
    let users: { id: string }[];
    try {
      users = await container.repos.users.listAll();
    } catch (error) {
      app.log.warn({ err: error }, "Could not list users for the trash purge");
      return;
    }
    for (const user of users) {
      try {
        const result = await container.trash.purgeExpired(user.id, days);
        if (result.deletedFiles > 0 || result.deletedFolders > 0) {
          app.log.info(
            {
              userId: user.id,
              deletedFiles: result.deletedFiles,
              deletedFolders: result.deletedFolders,
              failedFiles: result.failedFiles,
            },
            "Purged expired trash",
          );
        }
      } catch (error) {
        app.log.warn({ err: error, userId: user.id }, "Trash purge failed for a user");
      }
    }
  };
  void purgeTrash();
  setInterval(purgeTrash, 6 * 60 * 60 * 1000).unref();
} catch (error) {
  app.log.error({ err: error }, "Failed to start");
  await container.shutdown();
  process.exit(1);
}
