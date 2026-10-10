import type { FastifyInstance } from "fastify";
import type { HealthStatus } from "@omnicloud/shared";
import type { Container } from "../container";
import { toStatsDTO, toStorageDTO, toStorageHealthDTO } from "../mappers";
import { optionalBoolean, requireBody, requireStringArray } from "../validation";
import { ValidationError } from "@omnicloud/core";
import { encryptionCheck, readiness } from "../health";

const VERSION = "0.2.18";

/**
 * Storage endpoints: initialization, health, statistics and integrity
 * checking. /api/health is public (probes); the rest are authenticated.
 */
export function registerStorageRoutes(app: FastifyInstance, container: Container): void {
  // ── Public health probes ──────────────────────────────────────────────────
  app.get("/api/health", async () => {
    const database = await probeDatabase(container);
    return {
      status: database,
      database,
      storage: "unknown" as HealthStatus,
      uptimeSeconds: Math.round(process.uptime()),
      version: VERSION,
    };
  });

  // Liveness: the process is running. Deliberately checks no dependency.
  app.get("/api/health/live", async () => ({ status: "live" as const }));

  // Readiness: the API can serve requests. Storage is not part of readiness,
  // because a user may not have connected Telegram yet.
  app.get("/api/health/ready", async (_request, reply) => {
    const database = await probeDatabase(container);
    const report = readiness([
      {
        name: "database",
        state: database === "healthy" ? "healthy" : "unhealthy",
        detail: database === "healthy" ? null : "database did not answer",
      },
      encryptionCheck(container.config.encryptionKey !== null),
    ]);
    if (!report.ready) reply.status(503);
    return report;
  });

  app.get("/api/health/database", async () => {
    const database = await probeDatabase(container);
    return { status: database, database };
  });

  // ── Ensure storage exists (creates the Telegram channel on first use) ────
  app.post("/api/storage/ensure", async (request) => {
    const storage = await container.connection.ensureStorage(request.user.id);
    return { storage: toStorageDTO(storage) };
  });

  // ── Storage health for the signed-in user ────────────────────────────────
  app.get("/api/storage/health", async (request) => {
    const health = await container.storageHealth.health(request.user.id);
    const stats = await container.stats.stats(request.user.id, container.config.quotaBytes);
    return {
      health: toStorageHealthDTO({
        provider: "telegram",
        state: health.state,
        healthy: health.healthy,
        latencyMs: health.latencyMs,
        message: health.message,
        targetTitle: health.targetTitle,
      }),
      stats: toStatsDTO(stats),
    };
  });

  app.post("/api/storage/health/check", async (request) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const deep = optionalBoolean(body, "deep") ?? false;
    const health = await container.storageHealth.health(request.user.id, deep);
    return {
      health: toStorageHealthDTO({
        provider: "telegram",
        state: health.state,
        healthy: health.healthy,
        latencyMs: health.latencyMs,
        message: health.message,
        targetTitle: health.targetTitle,
      }),
    };
  });

  // ── Storage statistics ────────────────────────────────────────────────────
  app.get("/api/storage/stats", async (request) => {
    const stats = await container.stats.stats(request.user.id, container.config.quotaBytes);
    return { stats: toStatsDTO(stats) };
  });

  // ── Integrity check (read-only) ───────────────────────────────────────────
  // Read-only: reports channel objects no record references, and records whose
  // object is gone. It never deletes or repairs anything.
  // Repair step 1: a plan of actions that could be approved. Changes nothing.
  app.post("/api/storage/reconciliation/plan", async (request) => {
    const plan = await container.reconciliationFlow.plan(request.user.id);
    return { plan };
  });

  // Repair step 2: apply only the named approvals, after a fresh scan. Nothing
  // is deleted at the storage provider.
  app.post("/api/storage/reconciliation/apply", async (request) => {
    const body = requireBody(request);
    // An empty approval is valid and applies nothing, so the list may be empty here.
    const raw = (body as Record<string, unknown>).approvedIds;
    const approvedIds =
      Array.isArray(raw) && raw.length === 0 ? [] : requireStringArray(body, "approvedIds");
    if (approvedIds.length > 200) throw new ValidationError("Approve at most 200 repairs at once");
    const result = await container.reconciliationFlow.apply(request.user.id, approvedIds);
    return { result };
  });

  app.post("/api/storage/reconciliation", async (request) => {
    const report = await container.reconciliation.run(request.user.id);
    return { report };
  });

  app.post("/api/storage/integrity/check", async (request) => {
    const body = requireBody(request);
    const deep = optionalBoolean(body, "deep") ?? false;
    const report = await container.integrity.check(request.user.id, { deep });
    return { report };
  });
}

async function probeDatabase(container: Container): Promise<HealthStatus> {
  try {
    // A cheap query proves connectivity without loading data.
    await container.repos.users.findById("__health_probe__");
    return "healthy";
  } catch {
    return "unavailable";
  }
}
