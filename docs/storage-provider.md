# Storage provider abstraction (v0.2)

The application never talks to Telegram directly. Every byte of file content
flows through two layers:

```text
service → StorageEngine → StorageProvider → (TelegramStorageProvider → MTProto)
```

- `StorageProvider` (`packages/core/src/storage/provider.ts`) is the pluggable
  backend contract.
- `StorageEngine` (`packages/core/src/storage/engine.ts`) wraps a provider with
  the guarantees every backend must share: SHA-256, bounded retries, progress,
  cancellation and error mapping.

This document describes the v0.2 contract. For the v0.1-era design notes and the
"what lives where" rationale, see [storage.md](./storage.md); for the Telegram
implementation's login/channel/RPC details, see [telegram.md](./telegram.md).

## Core types

```ts
/** Reference to an object inside the backing store (opaque to callers). */
interface StoredRef {
  messageId: string;
}

interface StoredObject extends StoredRef {
  name: string;
  size: number;
  mimeType: string;
}

interface TransferProgress {
  transferred: number; // bytes transferred so far
  total: number | null; // total bytes when known upfront
  percent: number | null; // 0–100 when total is known, else null
}

interface TransferControl {
  signal?: AbortSignal; // aborts the operation
  onProgress?: (p: TransferProgress) => void;
}

interface StorageUploadInput {
  name: string;
  mimeType: string;
  data?: Buffer; // whole-object buffer (small files)
  stream?: Readable; // streaming source; data OR stream required
  size?: number; // total byte length, required when streaming
}

interface StorageDownloadInput {
  ref: StoredRef;
  stream?: boolean; // stream the result instead of buffering
}

interface StorageHealth {
  healthy: boolean;
  latencyMs: number | null; // round-trip probe latency, when measured
  message: string | null;
  targetTitle: string | null; // channel/target name, when available
}
```

`StoredRef.messageId` is provider-opaque. For Telegram it is the message id of
the document message; for another provider it would be a key or etag. Callers
must never parse it.

## The `StorageProvider` interface

```ts
interface StorageProvider {
  readonly name: string;

  put(input: StorageUploadInput, control?: TransferControl): Promise<StoredObject>;
  get(ref: StoredRef, control?: TransferControl): Promise<Buffer>;
  getStream(ref: StoredRef, control?: TransferControl): Promise<Readable>;
  delete(ref: StoredRef): Promise<void>;
  exists(ref: StoredRef): Promise<boolean>;
  stat(ref: StoredRef): Promise<StoredObject | null>;
  healthCheck(): Promise<StorageHealth>;
}
```

| Method        | Contract                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| `put`         | Uploads an object and returns its reference plus metadata. Reports progress; honors `control.signal`.     |
| `get`         | Downloads the full object as a `Buffer`.                                                                  |
| `getStream`   | Opens a `Readable` for the object (large-file friendly).                                                  |
| `delete`      | Removes the object. **Deleting an already-missing object must not throw** — cleanup must always complete. |
| `exists`      | `true`/`false` membership test.                                                                           |
| `stat`        | Returns metadata, or `null` when the object is gone (does not throw for a missing object).                |
| `healthCheck` | Validates the backend is reachable and usable.                                                            |

`name` is the provider identifier persisted on the `Storage` row (`"telegram"`
for the Telegram provider).

## `StorageEngine` wrapper

`StorageEngine` is constructed with a provider and an optional
`EngineRetryPolicy`:

```ts
interface EngineRetryPolicy {
  attempts: number; // total attempts, including the first
  baseDelayMs: number; // base delay; doubles per retry
}

const DEFAULT_RETRY_POLICY: EngineRetryPolicy = { attempts: 3, baseDelayMs: 400 };
```

The API builds one engine per user (each user has their own channel), cached in
the container and rebuilt from the stored registration on demand.

### Upload

```ts
async upload(input, control): Promise<{ stored: StoredObject; sha256: string; size: number }>
```

1. Materializes the input into a `Buffer` (`data`, or concatenated chunks from
   `stream`).
2. Computes SHA-256 over those bytes.
3. Emits `{ transferred: 0, total, percent: 0 }`.
4. Calls `provider.put({ ...input, data }, control)` with retries.
5. Emits `{ transferred: total, total, percent: 100 }`.

The checksum returned here is what `FileService` stores as `File.sha256`; the
metadata is only written after `upload` resolves.

> v0.2 materializes the whole input before uploading, so the engine's own
> `size`/`stream` handling is a convenience, not true streaming. Memory usage
> is bounded by `MAX_UPLOAD_MB`.

### Download

```ts
async download(ref, control): Promise<Buffer>
async downloadStream(ref, control): Promise<{ stream: Readable; hash: () => string | null }>
```

`download` buffers the object with retries. `downloadStream` retries opening
the stream; the returned `hash()` currently resolves to `null` (on-the-fly
stream hashing is not implemented in v0.2 — use `download` + `verifyIntegrity`
when a checksum is needed).

### Lifecycle and health

| Method                                  | Behavior                                                                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `remove(ref)`                           | Deletes with retries; wraps failures via `mapProviderError("Delete failed", …)`.                                                                          |
| `exists(ref)`                           | One attempt; failures become `mapProviderError("Storage lookup failed", …)`.                                                                              |
| `stat(ref)`                             | One attempt; failures become `mapProviderError("Storage lookup failed", …)`.                                                                              |
| `health()`                              | Calls `provider.healthCheck()`; a thrown error is converted to `{ healthy: false, latencyMs: null, message, targetTitle: null }` rather than propagating. |
| `verifyIntegrity(data, expectedSha256)` | `sha256Hex(data) === expectedSha256`.                                                                                                                     |

### Retry policy

`withRetry` runs up to `attempts` times with exponential backoff
(`baseDelayMs * 2^(attempt-1)`, abortable via `control.signal`).

An error is retried unless it is one of:

- `OperationCancelledError`, or an `AbortError` / `ABORT_ERR`;
- an error whose message matches `/AUTH|PASSWORD|PHONE|FLOOD_WAIT|not found|invalid/i`.

That is, transient transport/rate-limit-style failures retry; authentication
problems, validation problems, cancellation, missing objects and Telegram
`FLOOD_WAIT_n` do not. When retries are exhausted the last error is wrapped by
the caller-supplied mapper (default `UploadFailedError` for uploads,
`mapProviderError` elsewhere).

Cancellation is cooperative: `throwIfAborted` runs before each attempt, and
`delay` rejects immediately if the signal aborts mid-backoff.

### Error mapping

- `mapProviderError(message, error)` passes `DomainError`s through untouched and
  wraps anything else as `UploadFailedError` (502) with the original message
  appended.
- Download failures use `DOWNLOAD_FAILED` (502) via the same helper.
- Domain errors therefore keep their specific codes (`TELEGRAM_FILE_NOT_FOUND`,
  `TELEGRAM_AUTH_REQUIRED`, ...) all the way to the HTTP layer.

## Telegram provider specifics

`TelegramStorageProvider` (`packages/telegram/src/provider.ts`):

- Constructed from a connected `TelegramClient` plus `{ chatId, accessHash,
title }`; it builds an explicit `Api.InputPeerChannel` so it never depends on
  GramJS entity caches.
- `name = "telegram"`.
- `put` sends a `CustomFile` with `forceDocument: true` and `workers: 1`. The
  GramJS `progressCallback` is augmented with an `isCanceled` getter wired to
  `control.signal`, so cancellation aborts an in-flight upload. Progress is
  reported as a 0–1 fraction mapped onto bytes/percent.
- `put` rejects documents above 2 GB (`MAX_DOCUMENT_BYTES`) with
  `UPLOAD_FAILED` before touching the network.
- `get` fetches the message by id, downloads the media with a progress
  callback, and rejects non-buffer results with `TELEGRAM_FILE_NOT_FOUND`.
- `getStream` buffers via `get` and re-exposes a one-chunk `Readable`.
- `delete` calls `deleteMessages(..., { revoke: true })`.
- `exists` delegates to `stat`; `stat` returns `null` when the message or its
  document is missing, otherwise reads the filename attribute, size and MIME
  type from the document.
- `healthCheck` requires `client.connected`, probes the channel with
  `channels.GetFullChannel`, and returns the channel title and latency. Failures
  are mapped through `mapTelegramError` and reported (not thrown).
- Provider-level failures are routed through `mapTelegramError`, so RPC errors
  become structured domain errors (see
  [telegram.md](./telegram.md#rpc-error-mapping)).

## Adding a new provider

S3, WebDAV and local-disk providers are **explicitly out of scope for v0.2**.
The extension point exists, and this is how it is meant to be used:

1. Implement `StorageProvider` in a new package (for example
   `packages/s3`), with `name` set to the provider id you will persist.
2. Map its errors onto the core `DomainError` hierarchy (`StorageUnavailableError`
   for transient backend failure, `UploadFailedError` / `DownloadFailedError`
   for transfer failures, `NotFoundError`.
3. Register the backend per user. `Storage.provider` already exists and is
   unique per `(userId, provider)`, and the container resolves the engine from
   that row. A multi-provider deployment would extend the container's
   `EngineResolver` to select the implementation by `provider`, and the SDK's
   storage DTOs already carry a `provider` field.
4. Keep the invariants provider-agnostic: return a stable `StoredRef`, tolerate
   deletes of missing objects, and make `stat` return `null` (not throw) for a
   missing object.

Nothing in `packages/core` or the API needs to change for a new backend: the
services depend only on the `StorageProvider` / `StorageEngine` types.

## Related

- [storage.md](./storage.md) — v0.1 design notes, "what lives where", and the
  ordering/failure rules that v0.2 extends.
- [telegram.md](./telegram.md) — MTProto connection, session and channel
  management, file model, RPC error table.
- [architecture.md](./architecture.md) — reliability rules and request
  lifecycle.
