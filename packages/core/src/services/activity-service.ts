import type { ActivityAction, ResourceType } from "@omnicloud/shared";
import type { ActivityRepository } from "../repos";
import type { ActivityEventRecord, PageRequest, Paged } from "../types";

export interface RecordActivityInput {
  userId: string;
  action: ActivityAction;
  resourceType: ResourceType;
  resourceId: string;
  resourceName?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * The narrow interface other services depend on for activity logging, so a
 * no-op recorder can be substituted in tests and activity failures never
 * break the operation being logged.
 */
export interface ActivityRecorder {
  record(input: RecordActivityInput): Promise<void>;
}

/** Activity log with best-effort recording and retention pruning. */
export class ActivityService implements ActivityRecorder {
  constructor(
    private readonly activity: ActivityRepository,
    /** Days to retain events; older rows are pruned on demand. */
    private readonly retentionDays = 90,
  ) {}

  /**
   * Records an event. Never throws — a logging failure must not fail the
   * user-facing operation that produced it.
   */
  async record(input: RecordActivityInput): Promise<void> {
    try {
      await this.activity.record({
        userId: input.userId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        resourceName: input.resourceName ?? null,
        metadata: sanitizeMetadata(input.metadata),
      });
    } catch {
      // Swallow: activity logging is observability, not a transaction.
    }
  }

  async list(userId: string, page: PageRequest): Promise<Paged<ActivityEventRecord>> {
    return this.activity.list(userId, page);
  }

  /** Most recent distinct files for the given actions, for the Recent view. */
  async recentFiles(
    userId: string,
    actions: readonly ActivityAction[],
    limit: number,
  ): Promise<ActivityEventRecord[]> {
    return this.activity.recentFiles(userId, actions, limit);
  }

  async prune(): Promise<number> {
    const cutoff = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000);
    return this.activity.pruneOlderThan(cutoff);
  }
}

const SENSITIVE_KEY = /(password|secret|token|session|hash|credential)/i;

/**
 * Strips credential-shaped keys so the activity log can never become a place
 * where secrets leak.
 */
function sanitizeMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!metadata) return null;
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (value === undefined) continue;
    clean[key] = value;
  }
  return Object.keys(clean).length > 0 ? clean : null;
}

/** A recorder that discards events (used where activity is not wired up). */
export const noopActivityRecorder: ActivityRecorder = {
  async record() {
    /* intentionally empty */
  },
};
