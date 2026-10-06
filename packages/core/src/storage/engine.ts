import type { StoredObject, StoredRef, StorageProvider, StorageUploadInput } from "./provider";
import { StorageProviderError } from "../errors";

export { sha256Hex } from "../utils/hash";
import { sha256Hex } from "../utils/hash";

export interface EngineUploadResult {
  stored: StoredObject;
  sha256: string;
  size: number;
}

/**
 * Sits between the application and the raw StorageProvider and adds the
 * cross-cutting guarantees: SHA-256 integrity and consistent error mapping.
 *
 * The active provider is chosen per user by the host application (each user
 * has their own Telegram storage channel).
 */
export class StorageEngine {
  constructor(private readonly provider: StorageProvider) {}

  get providerName(): string {
    return this.provider.name;
  }

  /** Uploads an object and computes its checksum in one step. */
  async upload(input: StorageUploadInput): Promise<EngineUploadResult> {
    const sha256 = sha256Hex(input.data);
    let stored: StoredObject;
    try {
      stored = await this.provider.put(input);
    } catch (error) {
      throw mapProviderError("Upload failed", error);
    }
    return { stored, sha256, size: input.data.byteLength };
  }

  async download(ref: StoredRef): Promise<Buffer> {
    try {
      return await this.provider.get(ref);
    } catch (error) {
      throw mapProviderError("Download failed", error);
    }
  }

  async remove(ref: StoredRef): Promise<void> {
    try {
      await this.provider.delete(ref);
    } catch (error) {
      throw mapProviderError("Delete failed", error);
    }
  }

  async verifyIntegrity(data: Buffer, expectedSha256: string): Promise<boolean> {
    return sha256Hex(data) === expectedSha256;
  }
}

export function mapProviderError(message: string, error: unknown): StorageProviderError {
  if (error instanceof StorageProviderError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new StorageProviderError(detail ? `${message}: ${detail}` : message, error);
}
