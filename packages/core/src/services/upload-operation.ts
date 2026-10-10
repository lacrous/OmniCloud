/**
 * Upload operations are the durable record of one logical upload. They exist so
 * that a retried request (same operation id) can resume or replay instead of
 * writing a second Telegram object and a second file record.
 *
 * PENDING    accepted, Telegram write not started
 * UPLOADING  Telegram write in progress or its outcome unknown
 * COMMITTING the stored object is being turned into a file record by exactly one
 *            request, which holds this state as an exclusive claim
 * COMPLETED  Telegram object stored and file record committed; result is final
 * UNKNOWN    the Telegram write may have stored the object but the outcome is not
 *            known; it is resolved, never silently re-uploaded
 * FAILED     Telegram write definitively failed; the operation may be retried
 *            under a new id
 */
export type UploadOperationStatus =
  "PENDING" | "UPLOADING" | "COMMITTING" | "UNKNOWN" | "COMPLETED" | "FAILED";

const TRANSITIONS: Record<UploadOperationStatus, readonly UploadOperationStatus[]> = {
  PENDING: ["UPLOADING", "FAILED"],
  UPLOADING: ["COMMITTING", "FAILED", "UNKNOWN"],
  // UNKNOWN is resolved, never re-uploaded: the object is either found (committed) or
  // confirmed absent (failed). It is not a state a new request may claim.
  UNKNOWN: ["COMMITTING", "FAILED"],
  COMMITTING: ["COMPLETED", "UPLOADING"],
  COMPLETED: [],
  FAILED: [],
};

export function canTransition(from: UploadOperationStatus, to: UploadOperationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** A completed operation is final: replays return its result and never re-upload. */
export function isTerminal(status: UploadOperationStatus): boolean {
  return status === "COMPLETED" || status === "FAILED";
}

/** Operation ids are client-supplied; accept only a bounded, URL-safe token. */
export function isValidOperationId(id: string): boolean {
  return /^[A-Za-z0-9_-]{8,64}$/.test(id);
}

/** Raised when an operation with this id already exists for the user (a create race). */
export class OperationAlreadyExistsError extends Error {
  constructor() {
    super("An upload with this operation id already exists");
    this.name = "OperationAlreadyExistsError";
  }
}
