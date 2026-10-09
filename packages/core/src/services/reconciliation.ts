/**
 * Read-only reconciliation between the storage channel and the database.
 *
 * The channel is the user's own account storage, so this module never proposes
 * a deletion. It classifies what it finds and leaves every decision to a person:
 *
 *  - `referenced`   the message is recorded by a file, a version, or an
 *                   upload operation; nothing to do
 *  - `unknown`      a message exists in the channel that no record references;
 *                   it may be a leaked upload, or something the user put there
 *                   themselves, so it is reported and never removed
 *  - `dangling`     a record points at a message that is no longer in the channel
 */

export interface ReferenceSet {
  /** Message ids referenced by live file rows and version rows. */
  fileMessageIds: Set<number>;
  /** Message ids referenced by upload operations that have stored an object. */
  pendingUploadMessageIds: Set<number>;
}

export type ReconciliationFinding =
  | { kind: "referenced"; messageId: number }
  | { kind: "unknown"; messageId: number; sizeBytes: number | null }
  | { kind: "dangling"; messageId: number; recordedBy: "file" | "upload" };

export interface ReconciliationReport {
  scannedMessages: number;
  referencedMessages: number;
  unknown: Extract<ReconciliationFinding, { kind: "unknown" }>[];
  dangling: Extract<ReconciliationFinding, { kind: "dangling" }>[];
}

/**
 * Classifies channel messages against the database references. Pure: it reads
 * its inputs and decides nothing about what to delete.
 */
export function reconcile(
  channel: { messageId: number; sizeBytes: number | null }[],
  references: ReferenceSet,
): ReconciliationReport {
  const inChannel = new Set(channel.map((message) => message.messageId));
  const unknown: ReconciliationReport["unknown"] = [];
  let referenced = 0;

  for (const message of channel) {
    const isReferenced =
      references.fileMessageIds.has(message.messageId) ||
      references.pendingUploadMessageIds.has(message.messageId);
    if (isReferenced) {
      referenced += 1;
    } else {
      unknown.push({ kind: "unknown", messageId: message.messageId, sizeBytes: message.sizeBytes });
    }
  }

  const dangling: ReconciliationReport["dangling"] = [];
  for (const messageId of references.fileMessageIds) {
    if (!inChannel.has(messageId))
      dangling.push({ kind: "dangling", messageId, recordedBy: "file" });
  }
  for (const messageId of references.pendingUploadMessageIds) {
    if (!inChannel.has(messageId)) {
      dangling.push({ kind: "dangling", messageId, recordedBy: "upload" });
    }
  }

  return {
    scannedMessages: channel.length,
    referencedMessages: referenced,
    unknown,
    dangling,
  };
}
