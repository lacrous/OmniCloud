import type { IntegrityIssueDTO, IntegrityReportDTO } from "@omnicloud/shared";
import type { FileRecord } from "../types";
import type { FileRepository } from "../repos";
import type { EngineResolver } from "./file-service";
import { IntegrityCheckError } from "../errors";

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
    const versionsByFile = await this.files.listVersionsForFiles(targets.map((file) => file.id));

    for (const file of targets) {
      const issue = await this.inspect(file, options.deep ?? false, engine);
      if (issue) issues.push(issue);
      else healthy += 1;

      for (const version of versionsByFile.get(file.id) ?? []) {
        if (version.telegramMessageId === file.telegramMessageId) continue;
        const versionIssue = await this.inspectObject(
          {
            id: file.id,
            name: file.name,
            telegramMessageId: version.telegramMessageId,
            size: version.size,
            sha256: version.sha256,
          },
          options.deep ?? false,
          engine,
          version.id,
        );
        if (versionIssue) issues.push(versionIssue);
        else healthy += 1;
      }
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
    return this.inspectObject(
      {
        id: file.id,
        name: file.name,
        telegramMessageId: file.telegramMessageId,
        size: file.size,
        sha256: file.sha256,
      },
      deep,
      engine,
      undefined,
    );
  }

  private async inspectObject(
    target: {
      id: string;
      name: string;
      telegramMessageId: number;
      size: number;
      sha256: string;
    },
    deep: boolean,
    engine: Awaited<ReturnType<EngineResolver>>,
    versionId: string | undefined,
  ): Promise<IntegrityIssueDTO | null> {
    const ref = { messageId: String(target.telegramMessageId) };
    const withVersion = (issue: IntegrityIssueDTO): IntegrityIssueDTO =>
      versionId ? { ...issue, versionId } : issue;

    let stat: Awaited<ReturnType<typeof engine.stat>>;
    try {
      stat = await engine.stat(ref);
    } catch (error) {
      return withVersion({
        fileId: target.id,
        name: target.name,
        kind: "unreadable",
        detail: error instanceof Error ? error.message : "Storage lookup failed",
      });
    }

    if (!stat) {
      return withVersion({
        fileId: target.id,
        name: target.name,
        kind: "missing",
        detail: "No message with this id exists in the storage channel",
      });
    }

    if (stat.size !== target.size) {
      return withVersion({
        fileId: target.id,
        name: target.name,
        kind: "size_mismatch",
        detail: `metadata=${target.size} storage=${stat.size}`,
      });
    }

    if (deep) {
      try {
        // Streamed and hashed without holding the object in memory. A checksum
        // mismatch surfaces as IntegrityCheckError from the stream.
        const stream = await engine.downloadStream(ref, target.sha256);
        for await (const _chunk of stream) {
          // Consumed only to drive the verification; the bytes are discarded.
        }
      } catch (error) {
        if (error instanceof IntegrityCheckError) {
          return withVersion({
            fileId: target.id,
            name: target.name,
            kind: "hash_mismatch",
            detail: "Downloaded bytes do not match the stored SHA-256",
          });
        }
        return withVersion({
          fileId: target.id,
          name: target.name,
          kind: "unreadable",
          detail: error instanceof Error ? error.message : "Download failed",
        });
      }
    }

    return null;
  }
}
