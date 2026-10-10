import type { Readable } from "node:stream";

/**
 * Generic storage abstraction. The application must never depend on
 * Telegram-specific details — it talks to a StorageProvider.
 *
 * v0.2 adds streaming, progress reporting, cancellation and health checks
 * while keeping the abstraction provider-agnostic.
 */

/** Reference to an object inside the backing store (opaque to callers). */
export interface StoredRef {
  messageId: string;
}

export interface StoredObject extends StoredRef {
  name: string;
  size: number;
  mimeType: string;
}

/** Transfer progress emitted during upload/download. */
export interface TransferProgress {
  /** Bytes transferred so far. */
  transferred: number;
  /** Total bytes, when known upfront. */
  total: number | null;
  /** 0–100 when total is known, otherwise null. */
  percent: number | null;
}

export interface TransferControl {
  /** Aborted when the caller cancels the operation. */
  signal?: AbortSignal;
  onProgress?: (progress: TransferProgress) => void;
}

/**
 * Upload input. Exactly one of `data` (small, in memory) or `path` (a spooled
 * file on disk, read in slices by the provider) must be given.
 */
export interface StorageUploadInput {
  name: string;
  mimeType: string;
  /** Whole-object buffer (small files). */
  data?: Buffer;
  /** Path to a spooled file (large files). Its bytes are never fully loaded. */
  path?: string;
  /** Total byte length of the object. Required with `path`. */
  size?: number;
  /** SHA-256 of the spooled bytes, computed while they were written. Required with `path`. */
  sha256?: string;
  /** Message caption that identifies this upload, so a later search can find it. */
  caption?: string;
}

export interface StorageDownloadInput {
  ref: StoredRef;
  /** Stream the result instead of buffering it. */
  stream?: boolean;
}

export interface StorageHealth {
  /** Reachable and usable. */
  healthy: boolean;
  /** Round-trip latency of the probe in milliseconds, when measured. */
  latencyMs: number | null;
  message: string | null;
  /** Name of the storage channel/target, when available. */
  targetTitle: string | null;
}

export interface StorageProvider {
  readonly name: string;

  /**
   * Uploads an object and returns the stored reference. Reports progress and
   * honors `control.signal` for cancellation.
   */
  put(input: StorageUploadInput, control?: TransferControl): Promise<StoredObject>;

  /** Downloads the object's content as a Buffer. */
  get(ref: StoredRef, control?: TransferControl): Promise<Buffer>;

  /** Opens a stream for the object (large-file friendly). */
  getStream(ref: StoredRef, control?: TransferControl): Promise<Readable>;

  /** Deletes the object. Deleting an already-missing object must not throw. */
  delete(ref: StoredRef): Promise<void>;

  exists(ref: StoredRef): Promise<boolean>;

  stat(ref: StoredRef): Promise<StoredObject | null>;

  /**
   * Lists the objects the backing store holds, newest first, read-only. Used by
   * reconciliation; it must never modify anything. Implementations page through
   * the store and stop once `limit` objects are returned.
   */
  listObjects(limit: number): Promise<StoredObject[]>;

  /**
   * Finds stored objects whose content hash and size match, read-only. Used to
   * recover an upload whose outcome was unknown. Providers that cannot search
   * omit it, and the caller then treats the outcome as unresolved.
   */
  findByCaption?(caption: string, size: number): Promise<StoredObject[]>;

  /** Validates that the backing store is reachable and usable. */
  healthCheck(): Promise<StorageHealth>;
}
