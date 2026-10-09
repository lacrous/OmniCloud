import { sweepStaleSpools, type OperationSink } from "@omnicloud/core";
import { loadConfig } from "./config";
import { buildContainer } from "./container";
import { createApp } from "./app";

const config = loadConfig();
const operationLogTarget: { log: OperationSink | null } = { log: null };
const container = buildContainer(config, {
  operationLog: {
    info: (record, message) => operationLogTarget.log?.info(record, message),
    warn: (record, message) => operationLogTarget.log?.warn(record, message),
  },
});
const app = await createApp(container);
operationLogTarget.log = app.log;

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "Shutting down");
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
} catch (error) {
  app.log.error({ err: error }, "Failed to start");
  await container.shutdown();
  process.exit(1);
}
