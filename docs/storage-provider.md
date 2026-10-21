# Storage provider abstraction

The application never talks to a storage backend directly. Every byte of file
content flows through two layers:

```text
service → StorageEngine → StorageProvider → (TelegramStorageProvider → MTProto)
```

- `StorageProvider` (`packages/core/src/storage/provider.ts`) is the pluggable
  backend contract.
- `StorageEngine` (`packages/core/src/storage/engine.ts`) wraps a provider with
  the guarantees every backend must share: SHA-256, bounded retries, progress,
  cancellation and error mapping.

This document is the implementer guide for the interface. For the "what lives
where" rationale and the ordering rules the application adds on top, see
[storage.md](storage.md). For the Telegram implementation's login, channel and
RPC details, see [telegram.md](telegram.md).

## Contents

- [Core types](#core-types)
- [The `StorageProvider` interface](#the-storageprovider-interface)
  - [`put`](#put)
  - [`get`](#get)
  - [`getStream`](#getstream)
  - [`delete`](#delete)
  - [`exists`](#exists)
  - [`stat`](#stat)
  - [`listObjects`](#listobjects)
  - [`findByCaption`](#findbycaption)
  - [`healthCheck`](#healthcheck)
- [What a correct implementation must guarantee](#what-a-correct-implementation-must-guarantee)
  - [Atomicity](#atomicity)
  - [Checksum verification](#checksum-verification)
  - [Error mapping](#error-mapping)
  - [Cancellation and progress](#cancellation-and-progress)
- [How `StorageEngine` uses the provider](#how-storageengine-uses-the-provider)
  - [Upload](#upload)
  - [Download](#download)
  - [Lifecycle and health](#lifecycle-and-health)
  - [Retry policy](#retry-policy)
  - [Error mapping in the engine](#error-mapping-in-the-engine)
- [The Telegram provider](#the-telegram-provider)
- [Implementing a second provider](#implementing-a-second-provider)
- [Related](#related)

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
  path?: string; // path to a spooled file (large files)
  size?: number; // total byte length, required with `path`
  sha256?: string; // SHA-256 of the spooled bytes, required with `path`
  caption?: string; // identifies this upload so a later search can find it
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

Exactly one of `data` and `path` describes the content. With `path`, the
provider reads the file from disk in slices, so the bytes are never fully
loaded; `size` and `sha256` are then required, because the engine has already
hashed the spool and the recorded checksum must match it.

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
  listObjects(limit: number): Promise<StoredObject[]>;
  findByCaption?(caption: string, size: number): Promise<StoredObject[]>;
  healthCheck(): Promise<StorageHealth>;
}
```

| Method          | Contract                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| `put`           | Uploads an object and returns its reference plus metadata. Reports progress; honors `control.signal`.       |
| `get`           | Downloads the full object as a `Buffer`.                                                                    |
| `getStream`     | Opens a `Readable` for the object (large-file friendly).                                                    |
| `delete`        | Removes the object. **Deleting an already-missing object must not throw** — cleanup must always complete.   |
| `exists`        | `true`/`false` membership test.                                                                             |
| `stat`          | Returns metadata, or `null` when the object is gone (does not throw for a missing object).                  |
| `listObjects`   | Read-only listing of the objects the store holds, newest first. Used by reconciliation.                     |
| `findByCaption` | Optional read-only search for stored objects with this caption and size. Used to resolve an unknown upload. |
| `healthCheck`   | Validates the backend is reachable and usable.                                                              |

`name` is the provider identifier persisted on the `Storage` row (`"telegram"`
for the Telegram provider). `Storage.provider` is unique per `(userId,
provider)`.

### `put`

```ts
put(input: StorageUploadInput, control?: TransferControl): Promise<StoredObject>;
```

- Stores exactly the bytes described by `input.data` or `input.path`.
- Returns a `StoredObject` whose `size` is the number of bytes actually stored.
  The engine compares it with the size it uploaded and fails the upload on a
  mismatch, so a provider must never report a size it did not write.
- `input.mimeType` is what the provider records; the application derives it
  from the file name before calling.
- `input.caption` identifies the upload. The application sets it to
  `<sha256>:<operationId>` so a retry of the same logical upload can find its
  own object and never another upload's.
- Must report progress through `control.onProgress`, starting at
  `{ transferred: 0, total, percent: 0 }` and ending at
  `{ transferred: total, total, percent: 100 }`.
- Must honor `control.signal` and abort the transfer when it fires.
- Throws when the object was not stored. A failure that leaves the outcome
  genuinely unknown must be marked non-retryable, because the engine retries a
  `DomainError` whose `retryable` flag is set — and a retry would write the
  object twice.

### `get`

```ts
get(ref: StoredRef, control?: TransferControl): Promise<Buffer>;
```

Returns the whole object. The engine verifies the checksum of the returned
buffer afterwards, so the bytes must be exactly what was stored.

### `getStream`

```ts
getStream(ref: StoredRef, control?: TransferControl): Promise<Readable>;
```

Opens a stream for the object. The engine holds the last chunk back until the
SHA-256 of everything before it matches the recorded checksum, so a corrupt
object errors the stream before its final bytes are released. A consumer
therefore never sees a complete-looking body that fails the checksum.

The stream must emit the stored bytes in order and must not truncate silently:
a short stream is a checksum failure, not a successful end.

### `delete`

```ts
delete(ref: StoredRef): Promise<void>;
```

Removes the object. Deleting an object that is already gone must resolve, not
throw: metadata cleanup has to complete even when the remote object has
already disappeared.

### `exists`

```ts
exists(ref: StoredRef): Promise<boolean>;
```

A membership test. `false` means the object is not there. A backend failure
must throw, so the engine can distinguish "missing" from "cannot tell".

### `stat`

```ts
stat(ref: StoredRef): Promise<StoredObject | null>;
```

Returns the object's metadata, or `null` when the object is gone. It must not
throw for a missing object.

### `listObjects`

```ts
listObjects(limit: number): Promise<StoredObject[]>;
```

Read-only listing of the objects the store holds, newest first. It is used by
reconciliation, which compares the channel with the database. It must never
modify anything, and it must page through the store and stop once `limit`
objects have been returned.

### `findByCaption`

```ts
findByCaption?(caption: string, size: number): Promise<StoredObject[]>;
```

Optional. Finds stored objects whose caption equals the given caption and
whose size matches. It is read-only, and it exists to resolve an upload whose
outcome was unknown: the application searches for the caption instead of
writing the file again.

A provider that cannot search omits the method. The caller then treats the
outcome as unresolved and reports a conflict rather than retrying the write.

### `healthCheck`

```ts
healthCheck(): Promise<StorageHealth>;
```

Probes the backend and reports whether it is reachable and usable. `latencyMs`
is the round-trip time of the probe when it was measured; `targetTitle` is the
name of the channel or bucket when the backend has one.

A failure must be **reported, not thrown** — the engine turns a thrown error
into an unhealthy result, but a provider that reports `healthy: false` with a
message gives the operator something to read.

## What a correct implementation must guarantee

### Atomicity

OmniCloud writes to the backend first and to PostgreSQL second; the full
ordering table is in
[storage.md](storage.md#ordering-and-failure-rules). That rule holds only if
the provider is honest about what happened:

- **Report success only when the object is durably stored.** A backend that
  accepted the bytes but lost the response must not return a `StoredObject`.
- **Distinguish "not written" from "written but the answer was lost."** The
  first case is a failure the engine may retry. The second case is ambiguous:
  retrying writes a second copy. The Telegram provider maps an ambiguous
  connection failure to a non-retryable `TelegramConnectionError`, and the
  application then resolves the upload by searching for the caption.
- **Do not report a size you did not write.** The engine compares the stored
  size with the uploaded size and fails the upload on a mismatch, because the
  recorded checksum and size would both be wrong.
- **A repeated delete is not an error.** Metadata cleanup must always finish.

### Checksum verification

The engine owns the checksum, not the provider — see
[Download](#download) for what it does with it. For a provider this comes
down to one rule: **return the bytes you stored, unmodified and in order.**
Do not compress, transcode or re-encode.

### Error mapping

Provider failures are mapped onto the core `DomainError` hierarchy, which the
API turns into structured HTTP responses. Throw these rather than raw errors:

| Error                       | Status | Use it for                                        |
| --------------------------- | ------ | ------------------------------------------------- |
| `StorageUnavailableError`   | 503    | The backend is reachable but failing.             |
| `UploadFailedError`         | 502    | The transfer failed.                              |
| `DownloadFailedError`       | 502    | The transfer failed while reading.                |
| `NotFoundError`             | 404    | The object is missing.                            |
| `TelegramAuthRequiredError` | 401    | The backend needs re-authentication.              |
| `TelegramConnectionError`   | 502    | The backend is unreachable. Retryable by default. |
| `RateLimitedError`          | 429    | The backend asked you to slow down.               |
| `OperationCancelledError`   | 499    | The caller cancelled the operation.               |

A `DomainError` carries a `retryable` flag and an optional
`retryAfterSeconds`. The flag — not the message text — decides whether the
engine retries. A rate limit is retryable; an authentication failure is not; a
missing object is not.

`OperationCancelledError` is the odd one out: it carries the code
`INVALID_REQUEST` with the non-standard status `499`, and it is never retried.

### Cancellation and progress

- Check `control.signal` before starting and while transferring. When it
  fires, stop and throw `OperationCancelledError`.
- Report progress through `control.onProgress` with bytes transferred, the
  total when it is known, and a percentage between 0 and 100.
- `total` is `null` when the backend cannot know the length upfront, and
  `percent` is `null` in that case.

## How `StorageEngine` uses the provider

`StorageEngine` is constructed with a provider and an optional retry policy:

```ts
interface EngineRetryPolicy {
  attempts: number; // total attempts, including the first
  baseDelayMs: number; // base delay; doubles per retry
}

const DEFAULT_RETRY_POLICY: EngineRetryPolicy = { attempts: 3, baseDelayMs: 400 };
```

The API builds one engine per user (each user has their own channel), caches it
in the container and rebuilds it from the stored registration on demand.

### Upload

```ts
async upload(input, control): Promise<{ stored: StoredObject; sha256: string; size: number }>
```

1. Emits `{ transferred: 0, total, percent: 0 }`.
2. Computes the SHA-256: from `input.data` for a buffer, or from the
   `input.sha256` the caller computed while writing the spool.
3. Calls `provider.put(input, control)` with retries.
4. Compares `stored.size` with the uploaded size and fails the upload on a
   mismatch.
5. Emits `{ transferred: total, total, percent: 100 }`.

The checksum returned here is what `FileService` stores as `File.sha256`; the
metadata row is only written after `upload` resolves.

> **Note:** the engine passes the input through. A `data` buffer is handed to
> the provider as a buffer, and a `path` is handed over as a path, so the
> provider decides whether it reads the file into memory or streams it from
> disk. The Telegram provider streams a spooled file by path.

### Download

```ts
async download(ref, control): Promise<Buffer>
async downloadStream(ref, expectedSha256, control): Promise<Readable>
async hashObject(ref, control): Promise<{ sha256: string; size: number }>
```

`download` buffers the object with retries.

`downloadStream` retries opening the stream, then verifies the SHA-256 of the
streamed bytes against `expectedSha256`. The last chunk is held back until the
digest of everything before it matches, so a corrupt object errors the stream
before its final bytes are released. Memory stays bounded to about two provider
chunks.

> **Note:** the checksum can only be checked once the whole object has been
> read, so a consumer that stops reading early gets no error and has seen
> unverified bytes. Read the stream to the end to have the checksum enforced.
> A caller that also knows the expected length can detect an early stop
> itself; the SDK does this from the response's `Content-Length`.

`hashObject` reads the object in chunks and returns its checksum and length
without holding the object in memory. It is used to adopt an object whose
checksum is not yet known, such as an orphan found by reconciliation.

### Lifecycle and health

| Method                                  | Behavior                                                                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `remove(ref)`                           | Deletes with retries; wraps failures via `mapProviderError("Delete failed", …)`.                                                                          |
| `exists(ref)`                           | One attempt; failures become `mapProviderError("Storage lookup failed", …)`.                                                                              |
| `stat(ref)`                             | One attempt; failures become `mapProviderError("Storage lookup failed", …)`.                                                                              |
| `list(limit)`                           | One attempt; failures become `mapProviderError("Storage listing failed", …)`.                                                                             |
| `findByCaption(caption, size)`          | One attempt; returns `null` when the provider does not implement it.                                                                                      |
| `health()`                              | Calls `provider.healthCheck()`; a thrown error is converted to `{ healthy: false, latencyMs: null, message, targetTitle: null }` rather than propagating. |
| `verifyIntegrity(data, expectedSha256)` | `sha256Hex(data) === expectedSha256`.                                                                                                                     |

### Retry policy

`withRetry` runs up to `attempts` times with exponential backoff
(`baseDelayMs * 2^(attempt-1)`, with full jitter), abortable via
`control.signal`.

Whether an error is retried comes from its declared contract, not from its
message text:

- `OperationCancelledError` is never retried.
- A `DomainError` is retried when its `retryable` flag is set. A rate limit
  (`RateLimitedError`) and an unreachable backend
  (`TelegramConnectionError`) are retryable; authentication failures,
  validation failures and missing objects are not.
- Anything that is not a `DomainError` is not retried.

A provider-supplied `retryAfterSeconds` is honoured exactly; otherwise the
delay is a jittered exponential backoff.

Cancellation is cooperative: `throwIfAborted` runs before each attempt, and
the delay rejects immediately if the signal aborts mid-backoff.

### Error mapping in the engine

- `mapProviderError(message, error)` passes `DomainError`s through untouched
  and wraps anything else as `UploadFailedError` (502) with the original
  message appended.
- Download, delete, lookup and listing failures use `mapProviderError`, so
  their specific codes (`TELEGRAM_FILE_NOT_FOUND`, `TELEGRAM_AUTH_REQUIRED`,
  …) survive to the HTTP layer.
- **Uploads are the exception.** The engine wraps an upload failure as
  `UploadFailedError` directly, so an upload error always reaches the client
  as `UPLOAD_FAILED` (502) with the original error in `details`.

## The Telegram provider

`TelegramStorageProvider` (`packages/telegram/src/provider.ts`):

- Constructed from a connected `TelegramClient` plus `{ chatId, accessHash,
title }`; it builds an explicit `Api.InputPeerChannel` so it never depends
  on GramJS entity caches.
- `name = "telegram"`.
- `put` sends a `CustomFile` with `forceDocument: true` and `workers: 1`. A
  spooled file is handed over by path, so GramJS reads the parts it needs from
  disk; an in-memory buffer is passed through unchanged. The GramJS
  `progressCallback` is augmented with an `isCanceled` getter wired to
  `control.signal`, so cancellation aborts an in-flight upload. Progress is
  reported as a 0–1 fraction mapped onto bytes/percent.
- `put` rejects documents above 2 GB (`MAX_DOCUMENT_BYTES`) with
  `UPLOAD_FAILED` before touching the network.
- `get` fetches the message by id, downloads the media with a progress
  callback, and rejects non-buffer results with `TELEGRAM_FILE_NOT_FOUND`.
- `getStream` streams Telegram download chunks through a `Readable`; the storage
  engine verifies the final SHA-256 before releasing the last chunk.
- `delete` calls `deleteMessages(..., { revoke: true })`.
- `exists` delegates to `stat`; `stat` returns `null` when the message or its
  document is missing, otherwise reads the filename attribute, size and MIME
  type from the document.
- `listObjects` walks the channel newest first and returns only messages that
  carry a document.
- `findByCaption` searches the channel for the exact caption and matches the
  size.
- `healthCheck` requires `client.connected`, probes the channel with
  `channels.GetFullChannel`, and returns the channel title and latency.
  Failures are mapped through `mapTelegramError` and reported (not thrown).
- Provider-level failures are routed through `mapTelegramError`, so RPC errors
  become structured domain errors (see
  [telegram.md](telegram.md#rpc-error-mapping)).

## Implementing a second provider

No second provider ships with OmniCloud. The extension point exists, and this
is how it is meant to be used:

1. **Implement `StorageProvider`** in a new package (for example
   `packages/s3`), with `name` set to the provider id you will persist. Start
   from the interface above and keep the contracts: a stable `StoredRef`,
   deletes of missing objects tolerated, `stat` returning `null` rather than
   throwing for a missing object, and a read-only `listObjects`.

2. **Map its errors onto the core `DomainError` hierarchy**, and set the
   `retryable` flag deliberately. `StorageUnavailableError` for a transient
   backend failure, `UploadFailedError` / `DownloadFailedError` for transfer
   failures, `NotFoundError` for a missing object, `RateLimitedError` when the
   backend asks you to slow down. A `retryAfterSeconds` value is honoured
   exactly by the engine.

3. **Decide how an ambiguous failure is reported.** If the backend can accept
   bytes and lose the answer, do not report a plain failure — the engine would
   retry and write a second copy. Report it as a non-retryable error and let
   the application resolve the upload through `findByCaption`.

4. **Implement `findByCaption`** if the backend can search. The application
   uses it to resolve an upload whose outcome was unknown, and without it an
   ambiguous upload stays unresolved instead of being retried.

5. **Register the backend per user.** `Storage.provider` already exists and
   is unique per `(userId, provider)`, and the container resolves the engine
   from that row. A multi-provider deployment extends the container's
   `EngineResolver` to select the implementation by `provider`, and the SDK's
   storage DTOs already carry a `provider` field.

6. **Keep the invariants provider-agnostic.** The services depend only on the
   `StorageProvider` / `StorageEngine` types, so nothing in `packages/core` or
   the API needs to change for a new backend — only the container's
   `EngineResolver`, which picks the implementation.

7. **Keep the ordering rule.** Provider first, metadata second, and delete the
   object if the metadata commit fails. See [storage.md](storage.md#ordering-and-failure-rules).

## Related

- [storage.md](storage.md) — "what lives where", the ordering and failure
  rules, and the Telegram file model.
- [telegram.md](telegram.md) — MTProto connection, session and channel
  management, file model, RPC error table.
- [architecture.md](architecture.md) — reliability rules and request
  lifecycle.
- [sdk.md](sdk.md) — the npm package that exports `StorageEngine` and
  `TelegramStorageProvider`.
