import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import type {
  StorageHealth,
  StorageProvider,
  StorageUploadInput,
  StoredObject,
  StoredRef,
  TransferControl,
} from "./provider";
import {
  IntegrityCheckError,
  OperationCancelledError,
  UploadFailedError,
  mapProviderError,
} from "../errors";

export { sha256Hex } from "../utils/hash";
import { sha256Hex } from "../utils/hash";

export interface EngineUploadResult {
  stored: StoredObject;
  sha256: string;
  size: number;
}

export interface EngineRetryPolicy {
  /** Total attempts, including the first. */
  attempts: number;
  /** Base delay in ms; doubles per retry. */
  baseDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: EngineRetryPolicy = { attempts: 3, baseDelayMs: 400 };

/** Errors that are worth retrying (transient transport/rate-limit issues). */
function isRetryable(error: unknown): boolean {
  if (error instanceof OperationCancelledError) return false;
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string }).code;
  // Abort/explicit cancellation never retries.
  if (name === "AbortError" || code === "ABORT_ERR") return false;
  // Auth/validation problems will not fix themselves.
  if (/AUTH|PASSWORD|PHONE|FLOOD_WAIT|not found|invalid/i.test(message)) return false;
  return true;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new OperationCancelledError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new OperationCancelledError());
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new OperationCancelledError();
}

/** Converts a Buffer into a single-chunk Readable. */
function bufferToStream(data: Buffer): Readable {
  return Readable.from([data]);
}

/**
 * Sits between the application and the raw StorageProvider and adds the
 * cross-cutting guarantees: SHA-256 integrity, streaming, progress reporting,
 * cancellation and bounded retries.
 *
 * The active provider is chosen per user by the host application (each user
 * has their own Telegram storage channel).
 */
export class StorageEngine {
  constructor(
    private readonly provider: StorageProvider,
    private readonly retryPolicy: EngineRetryPolicy = DEFAULT_RETRY_POLICY,
  ) {}

  get providerName(): string {
    return this.provider.name;
  }

  /**
   * Uploads an object, computing its SHA-256 as it goes and reporting
   * progress. Retries transient failures with exponential backoff.
   */
  async upload(
    input: StorageUploadInput,
    control: TransferControl = {},
  ): Promise<EngineUploadResult> {
    const data = await this.readInput(input);

    const sha256 = sha256Hex(data);
    control.onProgress?.({ transferred: 0, total: data.byteLength, percent: 0 });

    const stored = await this.withRetry(
      () => this.provider.put({ ...input, data }, control),
      control,
      (error) => new UploadFailedError("Upload failed", error),
    );

    control.onProgress?.({ transferred: data.byteLength, total: data.byteLength, percent: 100 });
    return { stored, sha256, size: data.byteLength };
  }

  async download(ref: StoredRef, control: TransferControl = {}): Promise<Buffer> {
    return this.withRetry(
      () => this.provider.get(ref, control),
      control,
      (error) => mapProviderError("Download failed", error),
    );
  }

  /**
   * Streams the object and verifies its SHA-256 against `expectedSha256`.
   *
   * The last chunk is held back until the digest of everything before it has
   * been checked, so a corrupt object errors the stream before its final bytes
   * are released. A consumer therefore never sees a complete-looking body that
   * fails the checksum. Memory stays bounded to about two provider chunks.
   */
  async downloadStream(
    ref: StoredRef,
    expectedSha256: string,
    control: TransferControl = {},
  ): Promise<Readable> {
    const source = await this.withRetry(
      () => this.provider.getStream(ref, control),
      control,
      (error) => mapProviderError("Download failed", error),
    );

    const hash = createHash("sha256");
    let held: Buffer | null = null;
    const gate = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        if (held) this.push(held);
        held = chunk;
        callback();
      },
      flush(callback) {
        if (hash.digest("hex") !== expectedSha256) {
          callback(new IntegrityCheckError("Downloaded content does not match its checksum"));
          return;
        }
        if (held) this.push(held);
        callback();
      },
    });
    source.once("error", (error) => gate.destroy(error));
    source.pipe(gate);
    return gate;
  }

  async remove(ref: StoredRef): Promise<void> {
    await this.withRetry(
      () => this.provider.delete(ref),
      {},
      (error) => mapProviderError("Delete failed", error),
    );
  }

  async exists(ref: StoredRef): Promise<boolean> {
    try {
      return await this.provider.exists(ref);
    } catch (error) {
      throw mapProviderError("Storage lookup failed", error);
    }
  }

  async stat(ref: StoredRef): Promise<StoredObject | null> {
    try {
      return await this.provider.stat(ref);
    } catch (error) {
      throw mapProviderError("Storage lookup failed", error);
    }
  }

  async health(): Promise<StorageHealth> {
    try {
      return await this.provider.healthCheck();
    } catch (error) {
      return {
        healthy: false,
        latencyMs: null,
        message: error instanceof Error ? error.message : "Storage health check failed",
        targetTitle: null,
      };
    }
  }

  async verifyIntegrity(data: Buffer, expectedSha256: string): Promise<boolean> {
    return sha256Hex(data) === expectedSha256;
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** Materializes an upload input so the checksum can be computed. */
  private async readInput(input: StorageUploadInput): Promise<Buffer> {
    if (input.data) return input.data;
    if (!input.stream) {
      throw new UploadFailedError("Upload input has neither data nor a stream");
    }
    const chunks: Buffer[] = [];
    for await (const chunk of input.stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
  }

  private async withRetry<T>(
    operation: () => Promise<T>,
    control: TransferControl,
    wrapError: (error: unknown) => Error,
  ): Promise<T> {
    const { attempts, baseDelayMs } = this.retryPolicy;
    let lastError: unknown;

    for (let attempt = 1; attempt <= Math.max(1, attempts); attempt += 1) {
      throwIfAborted(control.signal);
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt >= attempts || !isRetryable(error)) break;
        await delay(baseDelayMs * 2 ** (attempt - 1), control.signal);
      }
    }
    throw wrapError(lastError);
  }
}

export { bufferToStream };
