/**
 * Generic storage abstraction. The application must never depend on
 * Telegram-specific details — it talks to a StorageProvider.
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

export interface StorageUploadInput {
  name: string;
  mimeType: string;
  data: Buffer;
}

export interface StorageProvider {
  readonly name: string;

  /** Uploads the object and returns the stored reference. */
  put(input: StorageUploadInput): Promise<StoredObject>;

  /** Downloads the object's content. */
  get(ref: StoredRef): Promise<Buffer>;

  /** Deletes the object. Deleting an already-missing object must not throw. */
  delete(ref: StoredRef): Promise<void>;

  exists(ref: StoredRef): Promise<boolean>;

  stat(ref: StoredRef): Promise<StoredObject | null>;
}
