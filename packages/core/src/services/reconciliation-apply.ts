import type { Repos } from "../repos";
import type { RepairAction } from "./reconciliation-repair";

export interface ApplyResult {
  applied: { id: string; kind: RepairAction["kind"] }[];
  failed: { id: string; message: string }[];
}

/**
 * Applies only the approved repairs. Neither action ever calls a delete on the
 * storage provider: detaching marks a record, and adopting creates a record that
 * points at a message which already exists.
 */
export class ReconciliationApplier {
  constructor(
    private readonly repos: Pick<Repos, "files">,
    private readonly userId: string,
    private readonly engine: {
      stat(ref: {
        messageId: string;
      }): Promise<{ name: string; size: number; mimeType: string } | null>;
      /** Reads the object in chunks, so a large orphan is never fully buffered. */
      hashObject(ref: { messageId: string }): Promise<{ sha256: string; size: number }>;
    },
  ) {}

  async apply(actions: RepairAction[]): Promise<ApplyResult> {
    const applied: ApplyResult["applied"] = [];
    const failed: ApplyResult["failed"] = [];
    for (const action of actions) {
      try {
        if (action.kind === "detach-dangling") {
          await this.detach(action);
        } else {
          await this.adopt(action);
        }
        applied.push({ id: action.id, kind: action.kind });
      } catch (error) {
        failed.push({
          id: action.id,
          message: error instanceof Error ? error.message : "repair failed",
        });
      }
    }
    return { applied, failed };
  }

  private async detach(action: Extract<RepairAction, { kind: "detach-dangling" }>): Promise<void> {
    // Only a file record can be detached by marking it. A dangling upload operation
    // cannot be repaired here, and reporting it as applied would be a false success.
    if (action.recordedBy !== "file") {
      throw new Error("This finding belongs to an upload operation, which cannot be detached here");
    }
    const file = (await this.repos.files.listByUser(this.userId)).find(
      (candidate) => candidate.telegramMessageId === action.messageId,
    );
    if (!file) {
      throw new Error("No file of yours references this message, so there is nothing to detach");
    }
    await this.repos.files.update(file.id, { deletedAt: new Date(), trashBatchId: null });
  }

  private async adopt(action: Extract<RepairAction, { kind: "adopt-unknown" }>): Promise<void> {
    const ref = { messageId: String(action.messageId) };
    const object = await this.engine.stat(ref);
    if (!object) throw new Error("The channel message is no longer available");
    // The record's checksum must be the real one, read from the stored bytes. A
    // placeholder would make every later integrity check report a false mismatch.
    const { sha256, size } = await this.engine.hashObject(ref);
    if (size !== object.size) {
      throw new Error("The stored bytes do not match the object's reported size");
    }
    // Create the record and its first version together, so the adopted file has a
    // current version and a count that match a normal upload.
    await this.repos.files.createWithFirstVersion({
      userId: this.userId,
      folderId: null,
      name: `recovered-${action.messageId}-${object.name}`,
      size: object.size,
      mimeType: object.mimeType,
      sha256,
      telegramMessageId: action.messageId,
      version: {
        userId: this.userId,
        size: object.size,
        mimeType: object.mimeType,
        sha256,
        telegramMessageId: action.messageId,
      },
    });
  }
}
