import { loadConfig } from "./config";
import { buildContainer } from "./container";
import { createApp } from "./app";

const config = loadConfig();
const container = buildContainer(config);
const app = await createApp(container);

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "Shutting down");
  await app.close();
  await container.shutdown();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (error) {
  app.log.error({ err: error }, "Failed to start");
  await container.shutdown();
  process.exit(1);
}
