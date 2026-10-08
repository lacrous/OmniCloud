import type { IntegrityIssueDTO, IntegrityReportDTO } from "@omnicloud/shared";
import type { FileRecord } from "../types";
import type { FileRepository } from "../repos";
import type { EngineResolver } from "./file-service";

export interface IntegrityCheckOptions {
  /** Re-download and re-hash objects (slow but authoritative). */
  deep?: boolean;
  /** Maximum files to inspect in one pass. */
  limit?: number;
}

/**
 * Detects drift between PostgreSQL metadata and Telegram storage:
 *
 *  - `missing`     — metadata exists, the Telegram message is gone
 *  - `size_mismatch` — the stored object's size differs from the metadata
 *  - `hash_mismatch` — deep mode only: downloaded bytes don't match sha256
 *  - `unreadable`  — the provider errored while inspecting the object
 *
 * The checker is strictly read-only: repairs are a separate, explicit step so
 * nothing is ever deleted silently (see the v0.2 reliability rules).
 */
export class IntegrityService {
  constructor(
    private readonly files: FileRepository,
    private readonly engineFor: EngineResolver,
  ) {}

  async check(userId: string, options: IntegrityCheckOptions = {}): Promise<IntegrityReportDTO> {
    const startedAt = Date.now();
    const all = await this.files.listByUser(userId);
    const active = all.filter((file) => file.deletedAt === null);
    const targets = options.limit ? active.slice(0, options.limit) : active;

    const engine = await this.engineFor(userId);
    const issues: IntegrityIssueDTO[] = [];
    let healthy = 0;

    for (const file of targets) {
      const issue = await this.inspect(file, options.deep ?? false, engine);
      if (issue) issues.push(issue);
      else healthy += 1;
    }

    const missing = issues.filter((issue) => issue.kind === "missing").length;
    const inconsistent = issues.filter(
      (issue) => issue.kind === "size_mismatch" || issue.kind === "hash_mismatch",
    ).length;
    const unreadable = issues.filter((issue) => issue.kind === "unreadable").length;

    return {
      checkedAt: new Date().toISOString(),
      filesChecked: targets.length,
      healthy,
      missing,
      inconsistent,
      unreadable,
      issues,
      durationMs: Date.now() - startedAt,
    };
  }

  private async inspect(
    file: FileRecord,
    deep: boolean,
    engine: Awaited<ReturnType<EngineResolver>>,
  ): Promise<IntegrityIssueDTO | null> {
    const ref = { messageId: String(file.telegramMessageId) };

    let stat: Awaited<ReturnType<typeof engine.stat>>;
    try {
      stat = await engine.stat(ref);
    } catch (error) {
      return {
        fileId: file.id,
        name: file.name,
        kind: "unreadable",
        detail: error instanceof Error ? error.message : "Storage lookup failed",
      };
    }

    if (!stat) {
      return {
        fileId: file.id,
        name: file.name,
        kind: "missing",
        detail: "No message with this id exists in the storage channel",
      };
    }

    if (stat.size !== file.size) {
      return {
        fileId: file.id,
        name: file.name,
        kind: "size_mismatch",
        detail: `metadata=${file.size} storage=${stat.size}`,
      };
    }

    if (deep) {
      try {
        const data = await engine.download(ref);
        const ok = await engine.verifyIntegrity(data, file.sha256);
        if (!ok) {
          return {
            fileId: file.id,
            name: file.name,
            kind: "hash_mismatch",
            detail: "Downloaded bytes do not match the stored SHA-256",
          };
        }
      } catch (error) {
        return {
          fileId: file.id,
          name: file.name,
          kind: "unreadable",
          detail: error instanceof Error ? error.message : "Download failed",
        };
      }
    }

    return null;
  }
}
