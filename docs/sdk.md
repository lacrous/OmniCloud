# SDK and CLI (`@hilbras/omnicloud`)

The npm package `@hilbras/omnicloud` ships three things:

- **`OmniCloudClient`** — the HTTP client for an OmniCloud server. It runs in
  Node and in the browser.
- **Server building blocks** — the storage abstraction, the domain services and
  the Telegram integration. They need a persistent MTProto connection, so they
  run on the server only.
- **The `omnicloud` command** — starts a complete OmniCloud server and provides
  the end-to-end-encryption commands.

Requires Node.js 20 or newer. The package is ESM-first, ships a CommonJS build,
and ships TypeScript declarations.

> **Note:** client-side end-to-end encryption (OCE1) is **opt-in and
> experimental, and has not been independently reviewed**. See
> [Encryption](#encryption-oce1) before you rely on it.

## Contents

- [Install](#install)
- [`OmniCloudClient`](#omnicloudclient)
  - [Constructor options](#constructor-options)
  - [Authentication](#authentication)
  - [Errors](#errors)
  - [Error codes](#error-codes)
  - [Retry policy](#retry-policy)
  - [Pagination](#pagination)
- [Namespaces](#namespaces)
  - [`files`](#files)
  - [`folders`](#folders)
  - [`trash`](#trash)
  - [`storage`](#storage)
  - [`search`](#search)
  - [`recent`](#recent)
  - [`activity`](#activity)
  - [`auth`](#auth)
- [Node and browser](#node-and-browser)
- [Streaming](#streaming)
- [Encryption (OCE1)](#encryption-oce1)
- [The `omnicloud` CLI](#the-omnicloud-cli)
- [Server building blocks](#server-building-blocks)
- [Related](#related)

## Install

```bash
npm install @hilbras/omnicloud
# or
pnpm add @hilbras/omnicloud
```

To run a server instead of calling one, see
[`docs/deployment.md`](deployment.md#install-from-npm) and the
[README quick start](../README.md#quick-start).

## `OmniCloudClient`

```ts
import { OmniCloudClient } from "@hilbras/omnicloud";

const cloud = new OmniCloudClient({
  baseUrl: "https://cloud.example", // default: same-origin (relative URLs)
  token: undefined, // optional Bearer token
  fetchImpl: undefined, // custom fetch (tests/polyfills)
  retry: { attempts: 3, baseDelayMs: 300 }, // transient-failure retry
  headers: { "x-custom": "value" }, // extra headers on every request
});
```

### Constructor options

| Option              | Default        | Notes                                                                                                          |
| ------------------- | -------------- | -------------------------------------------------------------------------------------------------------------- |
| `baseUrl`           | `""`           | Trailing slash is stripped. An empty value means relative URLs, so requests go to the current origin.          |
| `token`             | —              | Adds `Authorization: Bearer <token>`. The server accepts a personal API token on every protected `/api` route. |
| `fetchImpl`         | global `fetch` | Inject a polyfill or a test double.                                                                            |
| `retry.attempts`    | `3`            | Total attempts including the first.                                                                            |
| `retry.baseDelayMs` | `300`          | The backoff delay doubles per retry.                                                                           |
| `headers`           | `{}`           | Merged into every request. A `headers` entry overrides the `Authorization` header set from `token`.            |

All requests are sent with `credentials: "include"`, so a browser attaches the
session cookie on its own. Node's `fetch` has no cookie jar, so cookie auth
there needs the `Cookie` header supplied by the caller.

### Authentication

There are two ways to authenticate, and they are independent of each other.

**A personal API token.** Create one in the web app under **Settings → API
tokens**. The secret is shown once. Send it as a bearer token:

```ts
const cloud = new OmniCloudClient({
  baseUrl: "https://cloud.example",
  token: process.env.OMNICLOUD_TOKEN,
});

await cloud.auth.me();
```

The token is account-wide and stays valid until you revoke it. Send it in the
`Authorization` header; the server accepts `Authorization: Bearer <token>` on
every protected `/api` route. The same mechanism backs `omnicloud login` on the
CLI — see [The `omnicloud` CLI](#the-omnicloud-cli).

**A browser session cookie.** The server sets an httpOnly, SameSite=Lax cookie
named `omnicloud_session` when a user signs in with Telegram. The SDK never
reads it; it relies on `credentials: "include"` so the browser attaches it. The
server stores only the token's SHA-256 and expires the session after 30 days.

In Node, a cookie session is only usable if you forward the `Cookie` header
yourself — Node's `fetch` has no cookie jar. Use `token` instead.

The server-side session flow, for a self-hosted deployment, is:

1. `POST /api/auth/telegram/start` with the user's phone number. The server
   asks Telegram to send a login code.
2. `POST /api/auth/telegram/verify` with the phone number and the code. The
   response is either `{ status: "ok", user }` or
   `{ status: "password_required" }` when the account has a two-step password.
3. `POST /api/auth/telegram/password` with the phone number and the
   two-step password. The server then sets the session cookie.
4. `GET /api/auth/me` returns the signed-in user, the storage registration and
   the storage health. All three are `null` when nobody is signed in.

> **Note:** `GET /api/auth/me` reports the **browser session**, not the API
> token. With only a `token` configured it answers
> `{ user: null, storage: null, health: null }` even though your other calls
> are authenticated. The recovery-blob routes accept a bearer token directly;
> the rest of `/api/auth/*` is the sign-in flow.

> **Note:** the server never receives the user's Telegram credentials. It keeps
> the MTProto session server-side. See [telegram.md](telegram.md).

### Errors

Any non-2xx response throws an `OmniCloudError`:

```ts
import { OmniCloudError } from "@hilbras/omnicloud";

try {
  await cloud.files.get("missing-id");
} catch (error) {
  if (error instanceof OmniCloudError) {
    error.status; // HTTP status, e.g. 404
    error.code; // stable code, e.g. "FILE_NOT_FOUND"
    error.message; // human-readable
    error.requestId; // correlate with server logs (may be undefined)
    error.details; // optional structured detail
  }
}
```

`status` is `0` for failures that never reached the server, such as a
cancelled request or a network failure during an XHR upload.

### Error codes

`code` mirrors the server's `ERROR_CODES` for server-side failures. The
canonical table, with the HTTP status each code carries, is in
[api.md](api.md#error-codes). The SDK adds a small set of codes of its own for
failures that never reach the server:

| Code                          | Status | Raised when                                                                    |
| ----------------------------- | ------ | ------------------------------------------------------------------------------ |
| `ABORTED`                     | `0`    | An `AbortSignal` fired during a retry backoff, or the browser XHR was aborted. |
| `NETWORK_ERROR`               | `0`    | The browser XHR failed at the transport level.                                 |
| `DOWNLOAD_INCOMPLETE`         | `0`    | The body ended before `Content-Length` bytes arrived.                          |
| `DOWNLOAD_FAILED`             | varies | A download response was not 2xx and carried no JSON error body.                |
| `UPLOAD_FAILED`               | varies | An upload response was not 2xx and carried no JSON error body.                 |
| `INTERNAL_ERROR`              | varies | A non-2xx response carried no JSON error body.                                 |
| `INVALID_REQUEST`             | `0`    | `files.upload` was called without any content.                                 |
| `NOT_ENCRYPTED`               | `0`    | The file is plaintext, or uses an unsupported encryption format.               |
| `INVALID_ENCRYPTION_METADATA` | `0`    | The file claims OCE1 but `wrappedKey` or `metadataBlob` is missing.            |
| `TRUNCATED`                   | `0`    | The download ended before the OCE1 header was complete.                        |
| `INTEGRITY_MISMATCH`          | `0`    | The written size does not match the decrypted size.                            |
| `MIGRATION_VERIFY_FAILED`     | `0`    | A migrated file did not decrypt back to its original bytes.                    |
| `MIGRATION_UPLOAD_FAILED`     | `0`    | The replacement upload did not come back as OCE1.                              |
| `MIGRATION_STATE_INVALID`     | `0`    | The file is OCE1 but no plaintext version remains to verify against.           |
| `INVALID_ARGUMENT`            | `0`    | `downloadDecryptedToFile` was called without a destination path.               |

### Retry policy

`client.request()` retries an operation when it throws an `OmniCloudError`
whose status is `408`, `429` or `>= 500`, up to `retry.attempts` attempts with
exponential backoff.

Only `GET`, `HEAD`, `PUT`, `DELETE` and `OPTIONS` are retried. `POST` and
`PATCH` are sent once, because a failed `POST` may already have changed state.
Uploads handle their own retry (see [`files.upload`](#files)); downloads do not
retry automatically.

### Pagination

Every listing returns `{ page, limit, total, hasMore }`. `limit` defaults to
`50` and is capped server-side at `200` (`MAX_PAGE_SIZE`).

```ts
import type { ListQuery } from "@hilbras/omnicloud";

async function* allFiles(cloud: OmniCloudClient, query: ListQuery = {}) {
  let page = 1;
  for (;;) {
    const result = await cloud.files.list({ ...query, page, limit: 200 });
    yield* result.files;
    if (!result.pagination.hasMore) break;
    page += 1;
  }
}
```

## Namespaces

Every group is a sub-client, so calls read as `cloud.files.list(...)` and
`cloud.trash.empty()`. All response shapes are the DTOs from
`@omnicloud/shared`, which the package re-exports.

### `files`

| Method              | Signature                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list`              | `(query?: ListQuery) => Promise<FilesPageDTO>`                                                                                                                     |
| `get`               | `(id: string) => Promise<FileDTO>`                                                                                                                                 |
| `versions`          | `(id: string) => Promise<FileVersionDTO[]>`                                                                                                                        |
| `restoreVersion`    | `(id: string, versionId: string) => Promise<FileDTO>`                                                                                                              |
| `deleteVersion`     | `(id: string, versionId: string) => Promise<void>`                                                                                                                 |
| `upload`            | `(input: UploadInput, options?: UploadOptions) => Promise<FileDTO>`                                                                                                |
| `uploadEncrypted`   | `(input: EncryptedUploadInput, options: EncryptedUploadOptions) => Promise<EncryptedUploadResult>`                                                                 |
| `replace`           | `(id: string, input: UploadInput, options?: { operationId?: string }) => Promise<FileDTO>`                                                                         |
| `download`          | `(id: string, onProgress?: (p: DownloadProgress) => void) => Promise<DownloadResult>`                                                                              |
| `downloadEncrypted` | `(id: string, options: EncryptedDownloadOptions) => Promise<EncryptedDownloadResult>`                                                                              |
| `downloadStream`    | `(id: string, onProgress?: (p: DownloadProgress) => void) => Promise<StreamedDownload>`                                                                            |
| `downloadToFile`    | `(id: string, targetPath: string, onProgress?: (p: DownloadProgress) => void) => Promise<{ path: string; bytes: number; sha256: string \| null }>`                 |
| `downloadUrl`       | `(id: string) => string`                                                                                                                                           |
| `rename`            | `(id: string, name: string) => Promise<FileDTO>`                                                                                                                   |
| `star`              | `(id: string, starred?: boolean) => Promise<FileDTO>`                                                                                                              |
| `move`              | `(id: string, folderId: string \| null) => Promise<FileDTO>`                                                                                                       |
| `trash`             | `(id: string) => Promise<FileDTO>`                                                                                                                                 |
| `restore`           | `(id: string) => Promise<FileDTO>`                                                                                                                                 |
| `delete`            | `(id: string) => Promise<void>`                                                                                                                                    |
| `batch`             | `(operation: "trash" \| "restore" \| "delete" \| "star" \| "unstar" \| "move", ids: string[], options?: { folderId?: string \| null }) => Promise<BatchResultDTO>` |

```ts
const bytes = new Uint8Array([1, 2, 3]);
const newBytes = new Uint8Array([4, 5, 6]);

// List active files. folderId: null = root only; omit it to span every folder.
const page = await cloud.files.list({ folderId: null, sort: "name", order: "asc", limit: 50 });
// { files: FileDTO[], pagination }

const file = await cloud.files.get("file-id");
const versions = await cloud.files.versions("file-id");

// Restoring points the file back at the version that already exists. Nothing is
// re-uploaded, so the restored content keeps the version id its ciphertext is
// bound to and decrypts exactly as before. The current version cannot be removed
// this way.
const restored = await cloud.files.restoreVersion("file-id", "version-id");
await cloud.files.deleteVersion("file-id", "version-id");

// Upload with progress and cancellation.
const controller = new AbortController();
const uploaded = await cloud.files.upload(
  { data: new Blob([bytes]), name: "report.pdf" },
  {
    folderId: null,
    retry: 2, // 2 retries → up to 3 attempts in total
    signal: controller.signal,
    onProgress: ({ loaded, total, percent }) => console.log(percent, "%"),
  },
);

// Replace the content of an existing file, creating a new version.
await cloud.files.replace("file-id", { data: new Blob([newBytes]), name: "report-v2.pdf" });

// Buffers the whole file in memory.
const result = await cloud.files.download("file-id", (p) => console.log(p.loaded, p.total));
// { data: Buffer | Uint8Array, contentType, size, sha256, integrityVerified }

// A direct href for an <a> tag.
const href = cloud.files.downloadUrl("file-id");

// Stream instead of buffering: use this for large files.
const { stream, size, sha256 } = await cloud.files.downloadStream("file-id");
for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
  // handle each chunk; memory does not grow with the file
}

// Node only: stream straight to disk.
await cloud.files.downloadToFile("file-id", "/tmp/report.pdf");

// Upload inputs: a Blob/File, a Uint8Array, a web ReadableStream, a Node
// Readable, or (Node only) a file path.
import { createReadStream } from "node:fs";
await cloud.files.upload({ data: createReadStream("/data/big.bin"), name: "big.bin" });
await cloud.files.upload({ path: "/data/big.bin", name: "big.bin" });

await cloud.files.rename("file-id", "new-name.pdf");
await cloud.files.star("file-id", true);
await cloud.files.move("file-id", "folder-id"); // or null for root
await cloud.files.trash("file-id");
await cloud.files.restore("file-id");
await cloud.files.delete("file-id"); // PERMANENT (use trash first)

await cloud.files.batch("trash", ["id-1", "id-2"]);
await cloud.files.batch("move", ["id-1"], { folderId: null });
// { requested, succeeded, failed, errors }
```

`UploadInput`:

| Field  | Type                                                                            | Notes                                                           |
| ------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `data` | `Blob \| Uint8Array \| ReadableStream<Uint8Array> \| AsyncIterable<Uint8Array>` | The file content. Optional when `path` is given.                |
| `path` | `string`                                                                        | Node only: a path to read the file from. Use instead of `data`. |
| `name` | `string`                                                                        | The filename. The server derives the MIME type from it.         |

A `data` source that is a stream is read chunk by chunk into a single `Blob`, so
the whole body is still held in memory. Only `path` (Node) streams from disk
without buffering the content.

`UploadOptions`:

| Option        | Default | Notes                                                   |
| ------------- | ------- | ------------------------------------------------------- |
| `folderId`    | —       | Target folder. Omit it for the root folder.             |
| `onProgress`  | —       | Receives `{ loaded, total, percent }`.                  |
| `signal`      | —       | Aborts the upload (see [Cancellation](#cancellation)).  |
| `retry`       | `2`     | Number of retries after the first attempt.              |
| `operationId` | random  | Idempotency key. The same key is sent on every attempt. |

An upload with a fixed `operationId` is safe to repeat. The SDK generates one
key per `files.upload()` call and reuses it across that call's own retries, so
a retry after a lost response returns the original file instead of storing a
second copy. Pass your own `operationId` to get the same guarantee across
separate calls. The server accepts the key in the `Idempotency-Key` header or
as an `operationId` multipart field; the SDK sends the header.

`DownloadResult.sha256` comes from the `X-Content-SHA256` response header.
`integrityVerified` is `null`: the server no longer reports that header,
because it verifies the checksum before it releases the final bytes. Treat a
rejected or truncated download as a failed integrity check.

`files.download` is **deprecated** — it loads the whole file into memory. Use
`downloadToFile` (Node) or `downloadStream` (any runtime) for large files.

### `folders`

| Method    | Signature                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list`    | `(query?: ListQuery & { parentId?: string \| null }) => Promise<FoldersPageDTO>`                                                                                   |
| `tree`    | `() => Promise<FolderDTO[]>`                                                                                                                                       |
| `create`  | `(name: string, parentId?: string \| null) => Promise<FolderDTO>`                                                                                                  |
| `rename`  | `(id: string, name: string) => Promise<FolderDTO>`                                                                                                                 |
| `star`    | `(id: string, starred?: boolean) => Promise<FolderDTO>`                                                                                                            |
| `move`    | `(id: string, parentId: string \| null) => Promise<FolderDTO>`                                                                                                     |
| `trash`   | `(id: string) => Promise<FolderMutationResultDTO>`                                                                                                                 |
| `restore` | `(id: string) => Promise<FolderMutationResultDTO>`                                                                                                                 |
| `delete`  | `(id: string) => Promise<FolderMutationResultDTO>`                                                                                                                 |
| `batch`   | `(operation: "trash" \| "restore" \| "delete" \| "star" \| "unstar" \| "move", ids: string[], options?: { parentId?: string \| null }) => Promise<BatchResultDTO>` |

```ts
const root = await cloud.folders.list(); // root children
await cloud.folders.list({ parentId: "folder-id" });
await cloud.folders.list({ sort: "name", starred: true }); // filtered query
const tree = await cloud.folders.tree(); // the whole active folder tree

const folder = await cloud.folders.create("Documents", null);
await cloud.folders.rename(folder.id, "Docs");
await cloud.folders.star(folder.id, true);
await cloud.folders.move(folder.id, "parent-id"); // or null for root

const { affectedFolders, affectedFiles } = await cloud.folders.trash(folder.id);
await cloud.folders.restore(folder.id);
await cloud.folders.delete(folder.id); // PERMANENT subtree

await cloud.folders.batch("move", ["id-1"], { parentId: null });
```

`folders.list` accepts the shared `ListQuery` plus `parentId`. When `parentId`
is provided it is sent as `?parentId=<id>` (an empty string for the root);
otherwise the other query parameters are serialized normally. The paging and
sort parameters are kept in both cases, so page 2 is never silently answered
with page 1.

### `trash`

| Method      | Signature                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------ |
| `list`      | `(query?: ListQuery) => Promise<TrashPageDTO>`                                                               |
| `empty`     | `() => Promise<EmptyTrashResultDTO>`                                                                         |
| `retention` | `() => Promise<{ days: number }>`                                                                            |
| `purge`     | `() => Promise<{ deletedFiles: number; deletedFolders: number; failedFiles: number; skippedFiles: number }>` |

```ts
const trashed = await cloud.trash.list({ page: 1, limit: 50 });
// { files, folders, pagination }

const result = await cloud.trash.empty();
// { deletedFiles, deletedFolders, failedFiles }

// How long trashed items are kept before they are removed for good.
// 0 means the server keeps the trash indefinitely.
const { days } = await cloud.trash.retention();

// Remove the expired trash now, without waiting for the server's scheduled job.
// Items still within their retention period are left alone.
const purged = await cloud.trash.purge();
// { deletedFiles, deletedFolders, failedFiles, skippedFiles }
```

`failedFiles > 0` means some remote objects could not be deleted; the affected
items remain in the Trash and the call can be retried.

### `storage`

| Method           | Signature                                                             |
| ---------------- | --------------------------------------------------------------------- |
| `ensure`         | `() => Promise<StorageDTO>`                                           |
| `stats`          | `() => Promise<StorageStatsDTO>`                                      |
| `health`         | `() => Promise<{ health: StorageHealthDTO; stats: StorageStatsDTO }>` |
| `check`          | `(deep?: boolean) => Promise<StorageHealthDTO>`                       |
| `integrityCheck` | `(options?: { deep?: boolean }) => Promise<IntegrityReportDTO>`       |
| `serverHealth`   | `() => Promise<HealthDTO>`                                            |

```ts
const storage = await cloud.storage.ensure(); // creates the channel if needed
const stats = await cloud.storage.stats(); // StorageStatsDTO

const { health, stats: withStats } = await cloud.storage.health();
// GET /api/storage/health returns both in one call

const healthDeep = await cloud.storage.check(true); // deep Telegram round-trip
const report = await cloud.storage.integrityCheck({ deep: false }); // read-only
const server = await cloud.storage.serverHealth(); // public GET /api/health
```

Note the naming: `storage.health()` returns the combined `{ health, stats }`
payload, while `storage.check(deep)` returns just the `StorageHealthDTO` from
the explicit probe endpoint. `storage.integrityCheck()` is read-only — it never
deletes or repairs anything.

### `search`

| Method  | Signature                                                                           |
| ------- | ----------------------------------------------------------------------------------- |
| `query` | `(q: string, page?: { page?: number; limit?: number }) => Promise<SearchResultDTO>` |

```ts
const results = await cloud.search.query("type:pdf size:>10MB after:2026-01-01", {
  page: 1,
  limit: 50,
});
// { files, folders, pagination }
```

See the [query language](api.md#search-query-language).

### `recent`

| Method | Signature                                                              |
| ------ | ---------------------------------------------------------------------- |
| `list` | `(page?: { page?: number; limit?: number }) => Promise<RecentPageDTO>` |

```ts
const recent = await cloud.recent.list({ page: 1, limit: 20 });
// { items: [{ file, lastAction, lastActionAt }], pagination }
```

### `activity`

| Method | Signature                                                                |
| ------ | ------------------------------------------------------------------------ |
| `list` | `(page?: { page?: number; limit?: number }) => Promise<ActivityPageDTO>` |

```ts
const activity = await cloud.activity.list({ page: 1, limit: 50 });
// { events: ActivityEventDTO[], pagination }
```

### `auth`

| Method                   | Signature                                                                       |
| ------------------------ | ------------------------------------------------------------------------------- |
| `me`                     | `() => Promise<SessionInfo>`                                                    |
| `startTelegramLogin`     | `(phone: string) => Promise<void>`                                              |
| `verifyTelegramCode`     | `(phone: string, code: string) => Promise<TelegramVerifyResponse>`              |
| `submitTelegramPassword` | `(phone: string, password: string) => Promise<{ status: "ok"; user: UserDTO }>` |
| `logout`                 | `() => Promise<void>`                                                           |
| `getRecoveryBlob`        | `() => Promise<{ recoveryBlob: string \| null }>`                               |
| `setRecoveryBlob`        | `(recoveryBlob: string) => Promise<{ status: "ok" }>`                           |
| `clearRecoveryBlob`      | `() => Promise<{ status: "ok" }>`                                               |

```ts
const session = await cloud.auth.me();
// { user, storage, health } — all null when signed out

await cloud.auth.startTelegramLogin("+15551234567");

const verify = await cloud.auth.verifyTelegramCode("+15551234567", "12345");
if (verify.status === "password_required") {
  const done = await cloud.auth.submitTelegramPassword("+15551234567", "••••••");
  // { status: "ok", user }
}

await cloud.auth.logout();

// OCE1 recovery record: opaque ciphertext only — the server never sees the code.
const { recoveryBlob } = await cloud.auth.getRecoveryBlob(); // string | null
await cloud.auth.setRecoveryBlob(blobBase64); // exactly 72 bytes, base64
await cloud.auth.clearRecoveryBlob();
```

In the browser, the session cookie is set by the server; the SDK relies on
`credentials: "include"`. Sign-in must be initiated from the same origin (or an
origin listed in `ALLOWED_ORIGINS`), because state-changing requests are
origin-checked.

## Node and browser

| Concern    | Browser                                                                          | Node                                                                                              |
| ---------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Session    | httpOnly cookie via `credentials: "include"`                                     | Cookie header must be supplied by the caller if cookie auth is used; otherwise run with a `token` |
| Upload     | `XMLHttpRequest` for real upload progress and `abort()`                          | `fetch` + `FormData` (no granular progress)                                                       |
| Download   | Streamed via `response.body.getReader()` with progress; `data` is a `Uint8Array` | Same code path; `data` is a `Buffer` (the SDK prefers `Buffer` when available)                    |
| File input | `Blob` / `File`                                                                  | `Buffer` / `Uint8Array`                                                                           |

The upload client uses XHR when `XMLHttpRequest` exists and falls back to
`fetch` otherwise. In Node, `fetch` + `FormData` is used, so `onProgress` is not
called for uploads — the `fetch` request body has no progress events.

### Cancellation

`AbortSignal` support differs per call, because the SDK forwards the signal
only where the underlying transport accepts one:

| Call                                                             | In-flight abort | Notes                                                             |
| ---------------------------------------------------------------- | --------------- | ----------------------------------------------------------------- |
| `files.upload` (browser)                                         | yes             | The XHR is aborted with `xhr.abort()`.                            |
| `files.upload` (Node)                                            | no              | The signal stops further retries; it is not passed to `fetch`.    |
| `files.uploadEncrypted`                                          | yes             | The signal is passed to `fetch`.                                  |
| `uploadEncryptedStream`                                          | yes             | The signal is passed to `fetch`.                                  |
| `downloadDecryptedToFile`                                        | yes             | The signal is passed to the write pipeline.                       |
| `files.download`, `files.downloadStream`, `files.downloadToFile` | no              | These take no signal. Truncation is detected by the length check. |

An aborted request throws `OmniCloudError(0, "ABORTED", …)`.

`onProgress` reports the same shape everywhere: `{ loaded, total, percent }`,
where `total` and `percent` are `null` when the length is unknown.

## Streaming

These APIs keep memory bounded by the chunk size rather than the file size.

### `downloadStream`

```ts
const { stream, size, sha256, contentType } = await cloud.files.downloadStream("file-id", (p) =>
  console.log(p.loaded, p.total),
);

for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
  // handle each chunk
}
```

`size` is the declared `Content-Length`, or `null` when the server did not send
one. Read the stream to the end: a transfer that ends early errors the stream
with `DOWNLOAD_INCOMPLETE` instead of finishing quietly.

### `downloadToFile` (Node)

```ts
const { path, bytes, sha256 } = await cloud.files.downloadToFile("file-id", "/tmp/report.pdf");
```

The bytes go to a `.part` file that is renamed into place only after the full
length is verified. A failed or truncated download removes the `.part` file and
leaves nothing at the target path.

### `encryptFileToSpool` (Node)

Encrypts a file on disk into a private `0600` spool file, without holding the
plaintext or the ciphertext in memory.

```ts
import { encryptFileToSpool } from "@hilbras/omnicloud";

const spool = await encryptFileToSpool("/data/video.mp4", {
  urk, // your user root key; never sent to the server
  metadata: { name: "video.mp4", mimeType: "video/mp4" },
  chunkSize: 4 * 1024 * 1024, // optional
  spoolDir: "/secure/tmp", // optional, defaults to <tmpdir>/omnicloud-spool
});

console.log(spool.spoolPath, spool.size);
await spool.dispose(); // deletes the spool file
```

The spool directory is created at mode `0700` and the spool file at mode `0600`.
Call `dispose()` when you are done with it — the SDK does not delete it for you
here.

### `uploadEncryptedStream` (Node)

```ts
import { uploadEncryptedStream } from "@hilbras/omnicloud";

const result = await uploadEncryptedStream(client, "/path/to/video.mp4", {
  name: "video.mp4",
  urk, // your user root key (never sent to the server)
  folderId: "fld_123", // optional
  retry: 2, // optional, default 2
  signal: controller.signal, // optional
  spoolDir: "/secure/tmp", // optional, defaults to the OS temp dir
});
// { file, fileId, versionId }
```

The plaintext is encrypted into a `0600` temporary spool file first, then the
spool is streamed as a multipart body. The spool is deleted in a `finally`
block, including when the upload fails or is aborted. Retries replay the exact
same ciphertext bytes — nothing is re-encrypted and nothing is buffered in
memory.

### `downloadDecryptedToFile` (Node)

```ts
import { downloadDecryptedToFile } from "@hilbras/omnicloud";

const result = await downloadDecryptedToFile(client, "file_456", {
  urk,
  targetPath: "/downloads/video.mp4",
  // Or derive the path from the decrypted file name:
  // resolveTarget: (metadata) => `/downloads/${metadata.name}`,
  signal: controller.signal,
});
console.log(result.bytes, result.sha256, result.metadata.name);
```

The envelope is streamed from the response, decrypted chunk by chunk, and
written to `<targetPath>.part`, which is renamed into place **only after the
authenticated manifest verifies**. A truncated, tampered, or corrupt download
rejects and leaves nothing behind at the target path.

Downloading a file that is not OCE1-encrypted rejects with a clear error; there
is no fallback to plaintext.

### Larger files in the browser

In the browser, `encryptFileStreaming` (used internally by the web app above
32 MiB) spools ciphertext to OPFS where available, falling back to in-memory
Blob parts with a documented 1 GiB ceiling above which it rejects explicitly.

Measured throughput and caveats are in
[`docs/evidence/web-streaming-bench.md`](evidence/web-streaming-bench.md).

## Encryption (OCE1)

> **Warning:** client-side end-to-end encryption is **opt-in, experimental, and
> has not been independently reviewed**. The protocol has not been through an
> independent cryptographic review. Files stored without it remain readable by
> Telegram. See [README → End-to-end encryption](../README.md#end-to-end-encryption-experimental-opt-in)
> for what is and is not protected, and
> [docs/audits/encryption-review.md](audits/encryption-review.md) for the
> review status.

The SDK re-exports the OCE1 primitives from `@omnicloud/crypto`, so you can
build envelopes yourself, and it wraps them in helpers that talk to the API.

> **Note:** the SDK reads and writes **OCE1** only. OCE2 — the format that also
> hides the file name from the server — exists in the protocol and in the web
> app's migration, but it is **not enabled by default**, it is unreviewed, and
> the package exports no OCE2 helpers. `downloadEncrypted` rejects an OCE2 file
> with `NOT_ENCRYPTED`.

### The primitives

```ts
import { encryptFile, decryptFile, generateUrk, readHeader } from "@hilbras/omnicloud";

const urk = generateUrk(); // 32 bytes — your user root key

const encrypted = await encryptFile(plaintext, {
  urk,
  metadata: { name: "report.pdf", mimeType: "application/pdf" },
});
// { envelope, wrappedKey, metadataBlob, fileId, versionId, keyEpoch }

const header = readHeader(encrypted.envelope);
// { version, suite, keyEpoch, fileId, versionId }

const opened = await decryptFile({
  urk,
  fileId: header.fileId,
  versionId: header.versionId,
  keyEpoch: header.keyEpoch,
  envelope: encrypted.envelope,
  wrappedKey: encrypted.wrappedKey,
  metadataBlob: encrypted.metadataBlob,
});
// { plaintext, metadata }
```

`encryptFile` holds the whole file in memory. For large files use
[`encryptFileToSpool`](#encryptfiletospool-node) and
[`uploadEncryptedStream`](#uploadencryptedstream-node) instead.

### `uploadEncrypted` and `downloadEncrypted`

```ts
import { uploadEncrypted, downloadEncrypted } from "@hilbras/omnicloud";

const uploaded = await uploadEncrypted(
  cloud,
  { path: "/data/report.pdf" }, // or { data: bytes }
  {
    name: "report.pdf",
    urk,
    mimeType: "application/pdf", // optional
    folderId: null, // optional
    retry: 2, // optional, default 2
    signal: controller.signal, // optional
  },
);
// { file, fileId, versionId }

const opened = await downloadEncrypted(cloud, uploaded.fileId, { urk });
// { plaintext: Uint8Array, metadata: FileMetadata }
```

The same helpers are available as methods on the file namespace:
`cloud.files.uploadEncrypted(...)` and `cloud.files.downloadEncrypted(...)`.

`uploadEncrypted` encrypts the plaintext exactly once and then POSTs the
envelope with the four OCE1 text fields ahead of the file part. Retries replay
the very same envelope bytes and the same idempotency key, so a lost response
never re-encrypts.

`downloadEncrypted` refuses anything that is not OCE1: a plaintext file or an
unsupported format throws `OmniCloudError(0, "NOT_ENCRYPTED", …)`. There is no
silent fallback to plaintext anywhere in this module.

### Migrating a legacy plaintext file

```ts
import { migrateFile } from "@hilbras/omnicloud";

const result = await migrateFile(cloud, "file_789", { urk });
// { status: "migrated" | "migrated_with_plaintext_history" | "already_migrated",
//   fileId, plaintextVersionsRemaining }
```

`migrateFile` inspects first and is idempotent: rerunning it after a crash
resumes from stored state instead of duplicating work. The plaintext original
is deleted only after the stored ciphertext has been verified against it, and
only when it is the single historical version, so no version history is lost.
Multi-version files keep their plaintext history and the result reports how
much remains. Nothing is deleted before verification.

## The `omnicloud` CLI

`npx omnicloud` (installed globally as `omnicloud`) runs the server and the
end-to-end-encryption commands.

The two halves behave differently:

- **Server commands** read the environment and a `.env` file, apply database
  migrations and start the bundled server.
- **Encryption commands** talk to an **existing** OmniCloud server over HTTP.
  They never start a server and never read `.env`. They use their own config
  file.

### Setup

1. In the web app create a personal API token: **Settings → API tokens**.
2. Store it once:

```bash
omnicloud login --url https://cloud.example
# API token (paste from the web app): ····   ← typed with echo off
```

`login` validates the token against the server (`GET /api/tokens`) before saving
it to `~/.config/omnicloud/config.json` (override with `--config <path>`),
which is written at mode `0600`. `omnicloud logout` removes the stored token
locally; revoke it server-side in the web app.

### Server commands

| Command             | Flags                                    | What it does                                                                                                                                                                                     |
| ------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `omnicloud`         | —                                        | Applies migrations, starts the server and opens the browser.                                                                                                                                     |
| `omnicloud start`   | `--no-open`, `--env <file>`, `--migrate` | Starts the server. `--no-open` skips the browser, `--env` reads a specific file. `--migrate` is accepted for existing scripts and has no effect: migrations always run before the server starts. |
| `omnicloud migrate` | `--env <file>`                           | Applies pending **database** migrations and regenerates the Prisma client. See [the note below](#the-two-migrate-commands) before you rely on it.                                                |
| `omnicloud version` | —                                        | Prints the installed version. `--version` and `-v` also work.                                                                                                                                    |
| `omnicloud help`    | —                                        | Prints usage. `--help` and `-h` also work.                                                                                                                                                       |

Configuration is read from environment variables first, then from a `.env` file
in the current directory (or the file given with `--env`). Variables already set
in the environment are never overwritten.

On the first run, when there is no `.env` file and `DATABASE_URL` is not set,
`omnicloud` offers to create one. It asks for `DATABASE_URL`,
`TELEGRAM_API_ID` and `TELEGRAM_API_HASH`, generates an
`OMNICLOUD_ENCRYPTION_KEY`, and writes the file at mode `0600`. This needs an
interactive terminal.

### Encryption commands

| Command                           | Flags                                              | What it does                                                                                     |
| --------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `omnicloud login`                 | `--url <baseUrl>`, `--config <path>`               | Prompts for an API token, validates it against the server and stores it in the config file.      |
| `omnicloud logout`                | `--config <path>`                                  | Removes the stored token from the config. The token stays valid server-side until you revoke it. |
| `omnicloud key generate`          | `--keyfile <path>`, `--reveal`                     | Creates a root key. `--keyfile` persists it at mode `0600`; `--reveal` prints it once on a TTY.  |
| `omnicloud key status`            | `--keyfile <path>`, `--reveal`                     | Prints the keyfile path and the key fingerprint. `--reveal` also prints the key on a TTY.        |
| `omnicloud recovery generate`     | `--keyfile <path>`, `--reveal` (required)          | Creates a recovery record, stores it on the server and prints the recovery code once.            |
| `omnicloud recovery restore`      | `--keyfile <path>` or `--reveal` (one is required) | Recovers the root key from a recovery code and the stored record.                                |
| `omnicloud upload <path>`         | `--encrypt` (required), `--folder <id>`            | Encrypts the file client-side and uploads it.                                                    |
| `omnicloud download <id>`         | `--decrypt`, `-o <path>` / `--output <path>`       | Downloads the stored bytes, or decrypts them with `--decrypt`.                                   |
| `omnicloud migrate <fileId\|all>` | —                                                  | Encrypts legacy plaintext files in place.                                                        |
| `omnicloud versions <fileId>`     | `--restore <versionId>`, `--delete <versionId>`    | Lists a file's versions, restores one, or deletes one.                                           |

Every encryption command also accepts `--url <baseUrl>`, `--config <path>` and
`--keyfile <path>` where they apply, and takes `--reveal` where it applies. A
value option accepts both `--flag value` and `--flag=value`; `-o` also accepts
`-o=value`.

`login` accepts only `--config` and `--url`. `logout` accepts only `--config`.

### The two `migrate` commands

`migrate` is overloaded, and the two meanings are different:

| Invocation                   | What it does                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `omnicloud migrate`          | **Database** migrations: applies the pending Prisma migrations and regenerates the Prisma client. |
| `omnicloud migrate <fileId>` | **File** migration: encrypts one legacy plaintext file in place.                                  |
| `omnicloud migrate all`      | **File** migration: encrypts every legacy plaintext file in place.                                |

> **Note:** in the current build the bare `omnicloud migrate` form is not
> reachable. The command dispatcher routes every `migrate` invocation to the
> file-migration command, which then fails with
> `usage: omnicloud migrate <fileId|all>`. Database migrations still run
> automatically before the server starts (`omnicloud start`).

### File migration, in detail

```bash
omnicloud migrate file_789      # encrypt one legacy file in place
omnicloud migrate all           # encrypt every plaintext file
```

`migrate` re-downloads and decrypts the stored ciphertext, byte-compares it
with the original, and only then removes the plaintext predecessor (and only
when no other history is lost). A file that fails verification is reported and
left untouched:

```text
migrated report.pdf (file_789): migrated
FAILED report.pdf (file_789): Verification failed for file_789: … Nothing was deleted.
```

`migrate all` walks the active files page by page and only picks the ones that
are still plaintext, then prints a summary:

```text
Migrating 3 plaintext file(s)...
migrated report.pdf (file_789): migrated
done: 1 migrated, 0 migrated (plaintext history kept), 0 already encrypted, 0 failed
```

### Version history

```bash
omnicloud versions file_456                        # list a file's version history
omnicloud versions file_456 --restore ver_1        # make an earlier version current
omnicloud versions file_456 --delete ver_1         # remove one historical version
```

### Large files

`upload` switches to the streaming path automatically. Files of 8 MiB and above
(`STREAM_UPLOAD_THRESHOLD`) are encrypted into a `0600` spool file and streamed
as a disk-backed multipart body, so peak memory stays bounded by the chunk
size. Smaller files use the in-memory path; the wire format is identical. The
command needs no extra flag for multi-gigabyte files.

`download --decrypt` always uses the chunk-by-chunk path: the envelope is
streamed, decrypted and written to a `.part` file that is renamed into place
only after the manifest verifies. `download` without `--decrypt` writes the raw
stored bytes, and it buffers them in memory — for a very large file, use
`--decrypt` or the SDK's `downloadToFile` instead.

### Secret-handling rules

- **Secrets never appear in argv or environment variables, and are never
  logged.** The API token and root key enter the CLI through an interactive
  muted-echo prompt or a file the user explicitly created at mode `0600`.
- **On-screen secrets require `--reveal` and an interactive terminal.**
  `key generate`, `key status`, `recovery generate` and `recovery restore`
  print a key or code only when you pass `--reveal` and stdout is a TTY;
  redirected output is refused rather than silently written to a file.
- **No plaintext fallback.** `upload` requires `--encrypt` (there is no
  plaintext upload path), and `download --decrypt` refuses files that are not
  OCE1 — it tells you to `omnicloud migrate` them instead of writing anything.
- **Migration verifies before deleting.** `migrate` re-downloads and decrypts
  the stored ciphertext, byte-compares it with the original, and only then
  removes the plaintext predecessor.

### Keyfile threat note (explicit opt-in)

`--keyfile <path>` stores the root key as plaintext bytes on disk, mode `0600`
(created inside a `0700` directory). Anything that can read that file —
malware, a compromised account, a stolen backup of your home directory — can
decrypt every file the key protects. The CLI prints this warning when the file
is created and warns again if the file is ever found with loose permissions.
Prefer interactive entry, or keep the key only as a recovery code in your
password manager, on machines you do not fully control.

### Config reference

`~/.config/omnicloud/config.json` (or `$XDG_CONFIG_HOME/omnicloud/config.json`,
or `--config <path>`):

```json
{
  "url": "https://cloud.example",
  "token": "…personal API token…",
  "keyfile": "/home/you/omnicloud.key"
}
```

`url` and `keyfile` are not secrets; `token` is, which is why the file is
always written at `0600` inside a `0700` directory.

## Server building blocks

The package re-exports the pieces a self-hosted integration may need beyond
the HTTP client. They fall into three tiers.

### Tier 1 — the documented client surface

`OmniCloudClient`, `OmniCloudError`, the client option and result types
(`OmniCloudClientOptions`, `RetryOptions`, `UploadInput`, `UploadOptions`,
`UploadProgress`, `DownloadProgress`, `DownloadResult`, `StreamedDownload`),
the OCE1 helpers, and the shared DTO and error-code vocabulary
(`ERROR_CODES`, `FileDTO`, `FolderDTO`, `FileVersionDTO`, `ActivityEventDTO`,
`StorageStatsDTO`, `StorageHealthDTO`, `HealthDTO`, `IntegrityReportDTO`,
`BatchResultDTO`, `SessionInfo`, `ListQuery`, `PaginationDTO`, `SortField`,
`SortOrder`, `ItemStatus`, `ErrorCode`, `ApiErrorBody`, `ConnectionState`,
`HealthStatus`, `UserDTO`, `StorageDTO` and the query helpers `parseSearchQuery`,
`parseSize`, `paginationMeta`, `fileCategory`, `isFileCategory`,
`mimeFromFilename`, `mimeMatchersForType`).

This is the surface the package documents and asserts on in CI: the published
type declarations are checked against the source exports, and every method of
the `files`, `folders`, `trash`, `storage` and `auth` sub-clients is checked
against the built `.d.ts`.

### Tier 2 — the documented storage extension point

`StorageEngine`, `StorageProvider` and the types around it: `StoredRef`,
`StoredObject`, `StorageUploadInput`, `TransferControl`, `TransferProgress`,
`StorageHealth`, `EngineRetryPolicy`, `EngineUploadResult`, plus the helpers
`sha256Hex`, `mapProviderError` and `sanitizeFileName`.

`StorageProvider` is the interface a second backend implements; `StorageEngine`
is the wrapper that adds checksums, retries, progress and cancellation. See
[storage-provider.md](storage-provider.md).

### Tier 3 — exported for custom deployments

`TelegramClientManager`, `TelegramConnectionService`, `TelegramStorageProvider`,
`mapTelegramError`, `TELEGRAM_PROVIDER` and the types `ConnectionStatus`,
`TelegramCredentials`, `TelegramStorageOptions`.

Because `TelegramClientManager` and the Telegram provider require a live
MTProto connection, import them only in server code.

The domain services are exported for a deployment that assembles its own
container: `FileService`, `FolderService`, `SearchService`, `StatsService`,
`TrashService`, `IntegrityService`, `RecentService`, `ActivityService` and
`noopActivityRecorder`, with the records `FileRecord`, `FolderRecord`,
`FileVersionRecord`, `ActivityEventRecord`, `ActivityRecorder`, `FileDownload`,
`FolderMutationResult`, `IntegrityCheckOptions`, `EngineResolver`, `UserRecord`
and `DomainError`.

> **Note:** the package publishes no separate stability policy. "Documented"
> here means "described in this repository and covered by the package's own
> tests". The service constructors take `Repos` and an `EngineResolver`, which
> are integration types for the database layer rather than a consumer-facing
> API, so pin the package version if you depend on them.

## Related

- [api.md](api.md) — the HTTP reference: every route, the query parameters and
  the canonical error-code table.
- [storage-provider.md](storage-provider.md) — the `StorageProvider` interface
  and how to implement a second backend.
- [telegram.md](telegram.md) — the MTProto connection, the storage channel and
  the RPC error table.
- [deployment.md](deployment.md#install-from-npm) — running the server from
  npm.
- [security.md](security.md) — what is and is not protected.
