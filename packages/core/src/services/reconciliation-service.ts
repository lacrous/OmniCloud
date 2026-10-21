import type { Repos } from "../repos";
import type { EngineResolver } from "./file-service";
import { reconcile, type ReconciliationReport } from "./reconciliation";

const SCAN_LIMIT = 5000;

/**
 * Runs a read-only reconciliation for one user: lists that user's own storage
 * channel, collects that user's own references, and classifies the difference.
 * It never deletes or repairs anything.
 */
export class ReconciliationService {
  constructor(
    private readonly repos: Pick<Repos, "files" | "uploadOperations">,
    private readonly engineFor: EngineResolver,
  ) {}

  async run(userId: string, options: { limit?: number } = {}): Promise<ReconciliationReport> {
    const engine = await this.engineFor(userId);
    // The provider returns newest first and stops at the cap. A full page means
    // older messages were not read, so the scan is partial and says so.
    const limit = Math.max(1, options.limit ?? SCAN_LIMIT);
    const listed = await engine.list(limit);
    const truncated = listed.length >= limit;

    const fileMessageIds = new Set<number>();
    for (const file of await this.repos.files.listByUser(userId)) {
      fileMessageIds.add(file.telegramMessageId);
    }
    for (const version of await this.versionMessageIds(userId)) {
      fileMessageIds.add(version);
    }

    const pendingUploadMessageIds = await this.pendingUploadMessageIds(userId);

    return reconcile(
      listed.map((object) => ({
        messageId: Number(object.messageId),
        sizeBytes: object.size,
      })),
      { fileMessageIds, pendingUploadMessageIds },
      { limit, truncated },
    );
  }

  /**
   * Objects stored by an upload that has not yet completed. They are in-flight,
   * not orphaned, so they count as referenced until the operation settles.
   */
  private async pendingUploadMessageIds(userId: string): Promise<Set<number>> {
    const ids = new Set<number>();
    // UNKNOWN objects may still be held for an upload whose outcome is not known, so they
    // are protected from being reported as orphans, like in-flight ones. COMMITTING holds
    // a stored object while its file record is being written, so it is protected too.
    for (const status of ["UPLOADING", "PENDING", "UNKNOWN", "COMMITTING"] as const) {
      for (const operation of await this.repos.uploadOperations.listByStatus(userId, status)) {
        if (operation.telegramMessageId !== null) ids.add(operation.telegramMessageId);
      }
    }
    return ids;
  }

  /** Every version's message id for this user's files, including trashed ones. */
  private async versionMessageIds(userId: string): Promise<number[]> {
    const files = await this.repos.files.listByUser(userId);
    const byFile = await this.repos.files.listVersionsForFiles(files.map((file) => file.id));
    return [...byFile.values()].flat().map((version) => version.telegramMessageId);
  }
}
