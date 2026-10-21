import type { FastifyInstance } from "fastify";
import type { UpdateCheckDTO } from "@omnicloud/shared";
import type { UpdateChecker } from "../update-checker";

/**
 * Update-availability endpoint.
 *
 * Public, like the health probes: it exposes only the running version and the
 * newest published version of an open-source package, neither of which is
 * user data. The response is the cached result of the server's periodic check,
 * so polling this endpoint never touches the npm registry.
 */
export function registerUpdateRoutes(app: FastifyInstance, checker: UpdateChecker | null): void {
  app.get("/api/update/check", async (_request, reply) => {
    const result = checker?.current() ?? null;
    if (result === null) {
      // The first check has not completed yet. Tell the client to come back
      // rather than reporting a false "up to date".
      reply.header("cache-control", "no-store");
      return {
        status: "unknown",
        currentVersion: "",
        latestVersion: null,
        packageName: "",
        checkedAt: new Date().toISOString(),
        detail: "The update check has not completed yet.",
      } satisfies UpdateCheckDTO;
    }
    reply.header("cache-control", "no-store");
    return result;
  });
}
