import type { FileVersionRecord } from "../types";

/**
 * Which historical versions to keep. The current version is never a candidate,
 * whatever the policy says. The default keeps everything, so no version is ever
 * removed unless an operator opts in.
 */
export type VersionRetentionPolicy =
  | { kind: "KEEP_ALL" }
  | { kind: "KEEP_LATEST_N"; count: number }
  | { kind: "KEEP_FOR_DAYS"; days: number };

export const DEFAULT_RETENTION: VersionRetentionPolicy = { kind: "KEEP_ALL" };

/**
 * Returns the historical versions the policy would remove. Pure: it decides
 * nothing is deleted, the caller must delete the remote objects first.
 */
export function versionsToPrune(
  versions: FileVersionRecord[],
  currentVersionId: string | null,
  policy: VersionRetentionPolicy,
  now: Date,
): FileVersionRecord[] {
  const historical = versions
    .filter((version) => version.id !== currentVersionId)
    .sort((a, b) => b.versionNumber - a.versionNumber);

  switch (policy.kind) {
    case "KEEP_ALL":
      return [];
    case "KEEP_LATEST_N": {
      const keep = Math.max(0, policy.count);
      return historical.slice(keep);
    }
    case "KEEP_FOR_DAYS": {
      const cutoff = now.getTime() - policy.days * 24 * 60 * 60 * 1000;
      return historical.filter((version) => version.createdAt.getTime() < cutoff);
    }
  }
}
