# SDK (`@lacrous/omnicloud`) v0.2

The SDK ships the `OmniCloudClient` HTTP client plus the server-side building
blocks (storage abstraction, domain services and the Telegram integration) as
one package. The Telegram pieces are server-side only — they need a persistent
MTProto connection — while `OmniCloudClient` works in Node and in the browser.

## Install

```bash
pnpm add @lacrous/omnicloud
# or
npm install @lacrous/omnicloud
```

Requires Node 20+. The package is ESM-first with a CJS build and TypeScript
types.

## `OmniCloudClient`

```ts
import { OmniCloudClient } from "@lacrous/omnicloud";

const cloud = new OmniCloudClient({
  baseUrl: "https://cloud.example", // default: same-origin (relative URLs)
  token: undefined, // optional Bearer token
  fetchImpl: undefined, // custom fetch (tests/polyfills)
  retry: { attempts: 3, baseDelayMs: 300 }, // transient-failure retry
  headers: { "x-custom": "value" }, // extra headers on every request
});
```

| Option              | Default        | Notes                                                                                                                                              |
| ------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl`           | `""`           | Trailing slash is stripped; empty means relative URLs (same origin)                                                                                |
| `token`             | —              | Adds `Authorization: Bearer <token>`. The stock server uses cookie auth, so this is only for deployments that place token auth in front of the API |
| `fetchImpl`         | global `fetch` | Inject a polyfill or a test double                                                                                                                 |
| `retry.attempts`    | `3`            | Total attempts including the first                                                                                                                 |
| `retry.baseDelayMs` | `300`          | Backoff doubles per retry                                                                                                                          |
| `headers`           | `{}`           | Merged into every request                                                                                                                          |

All requests are sent with `credentials: "include"`, so cookie sessions work
in the browser and in Node fetch.

### Errors

Any non-2xx response throws:

```ts
import { OmniCloudError } from "@lacrous/omnicloud";

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

`code` mirrors the server's `ERROR_CODES`; the full table is in
[api.md](./api.md#error-codes). Cancellation surfaces as
`OmniCloudError(0, "ABORTED", ...)` and network failures during XHR uploads as
`OmniCloudError(0, "NETWORK_ERROR", ...)`.

### Retry policy

`request()` retries an operation when it throws an `OmniCloudError` whose status
is `408`, `429` or `>= 500`, up to `retry.attempts` with exponential backoff.
This covers idempotent JSON calls. Uploads handle their own retry (see below);
downloads do not retry automatically.

## Namespaced API

Every group is a sub-client, so calls read as `cloud.files.list(...)`,
`cloud.trash.empty()`, and so on. All response shapes match the DTOs in
`@omnicloud/shared` and the HTTP reference.

### `auth`

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
```

In the browser, the session cookie is set by the server; the SDK relies on
`credentials: "include"`. Sign-in must be initiated from the same origin (or an
origin listed in `ALLOWED_ORIGINS`), because state-changing requests are
origin-checked.

### `files`

```ts
// List active files. folderId: null = root; omit to span every folder.
const page = await cloud.files.list({ folderId: null, sort: "name", order: "asc", limit: 50 });
// { files: FileDTO[], pagination }

await cloud.files.get("file-id");
await cloud.files.versions("file-id");

// Upload with progress and cancellation
const controller = new AbortController();
const file = await cloud.files.upload(
  { data: new Blob([bytes]), name: "report.pdf" },
  {
    folderId: null,
    retry: 2, // 2 retries → up to 3 attempts total
    signal: controller.signal,
    onProgress: ({ loaded, total, percent }) => console.log(percent, "%"),
  },
);

// Download with progress + integrity metadata
const result = await cloud.files.download("file-id", (p) => console.log(p.loaded, p.total));
// { data: Buffer | Uint8Array, contentType, size, sha256, integrityVerified }

cloud.files.downloadUrl("file-id"); // direct href for an <a> tag

await cloud.files.replace("file-id", { data: new Blob([newBytes]), name: "report-v2.pdf" });
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

`UploadInput.data` accepts a `Blob`/`File` in the browser or a
`Uint8Array`/`Buffer` in Node; `name` is the filename and also determines the
server-side MIME type.

`UploadOptions`:

| Option       | Default | Notes                                     |
| ------------ | ------- | ----------------------------------------- |
| `folderId`   | —       | Target folder; omit for root              |
| `onProgress` | —       | Receives `{ loaded, total, percent }`     |
| `signal`     | —       | Aborts the upload (`AbortController`)     |
| `retry`      | `2`     | Number of retries after the first attempt |

`DownloadResult.sha256` and `.integrityVerified` come from the
`X-Content-SHA256` and `X-Integrity-Verified` response headers; both are `null`
when the headers are absent. `integrityVerified === false` means the bytes did
not match the stored checksum — treat the download as suspect.

### `folders`

```ts
const root = await cloud.folders.list(); // root children
await cloud.folders.list({ parentId: "folder-id" });
await cloud.folders.list({ sort: "name", starred: true }); // filtered query
const tree = await cloud.folders.tree(); // FolderDTO[]

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
is provided it is sent as `?parentId=<id>` (empty string for root); otherwise
the other query params are serialized normally.

### `trash`

```ts
const trashed = await cloud.trash.list({ page: 1, limit: 50 });
// { files, folders, pagination }

const result = await cloud.trash.empty();
// { deletedFiles, deletedFolders, failedFiles }
```

`failedFiles > 0` means some remote objects could not be deleted; the affected
items remain in the Trash and the call can be retried.

### `storage`

```ts
const storage = await cloud.storage.ensure(); // creates the channel if needed
const stats = await cloud.storage.stats(); // StorageStatsDTO

const { health, stats: withStats } = await cloud.storage.health();
// GET /api/storage/health returns both in one call

const healthDeep = await cloud.storage.check(true); // deep Telegram round-trip
const report = await cloud.storage.integrityCheck({ deep: false }); // read-only
const server = await cloud.storage.serverHealth(); // public GET /api/health
```

Note the naming: `storage.health()` returns the combined
`{ health, stats }` payload, while `storage.check(deep)` returns just the
`StorageHealthDTO` from the explicit probe endpoint.

### `search`

```ts
const results = await cloud.search.query("type:pdf size:>10MB after:2026-01-01", {
  page: 1,
  limit: 50,
});
// { files, folders, pagination }
```

See the [query language](./api.md#search-query-language).

### `recent` and `activity`

```ts
const recent = await cloud.recent.list({ page: 1, limit: 20 });
// { items: [{ file, lastAction, lastActionAt }], pagination }

const activity = await cloud.activity.list({ page: 1, limit: 50 });
// { events: ActivityEventDTO[], pagination }
```

### Pagination usage

Every listing returns `{ page, limit, total, hasMore }`. Iterate with:

```ts
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

`limit` is capped server-side at 200 (`MAX_PAGE_SIZE`).

## Node vs browser

| Concern    | Browser                                                                          | Node                                                                                              |
| ---------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Session    | httpOnly cookie via `credentials: "include"`                                     | Cookie header must be supplied by the caller if cookie auth is used; otherwise run with a `token` |
| Upload     | `XMLHttpRequest` for real upload progress and `abort()`                          | `fetch` + `FormData` (no granular progress)                                                       |
| Download   | Streamed via `response.body.getReader()` with progress; `data` is a `Uint8Array` | Same code path; `data` is a `Buffer` (the SDK prefers `Buffer` when available)                    |
| File input | `Blob` / `File`                                                                  | `Buffer` / `Uint8Array`                                                                           |

The upload client automatically uses XHR when `XMLHttpRequest` exists and falls
back to `fetch` otherwise. `AbortSignal` works in both paths (XHR calls
`xhr.abort()`; fetch is not used when XHR is available).

## Server-side building blocks

The package re-exports the pieces a self-hosted integration may need beyond the
HTTP client.

Storage abstraction and helpers:

- `StorageEngine`, `sha256Hex`, `mapProviderError`, `sanitizeFileName`
- Types: `StorageProvider`, `StorageEngine`, `StoredRef`, `StoredObject`,
  `StorageUploadInput`, `TransferControl`, `TransferProgress`, `StorageHealth`,
  `EngineRetryPolicy`, `EngineUploadResult`, `ItemQuery`, `Paged`,
  `PageRequest`, `Repos`, `StorageRecord`, `StorageStats`, `FileTypeBucket`

Domain services and records:

- `FileService`, `FolderService`, `SearchService`, `StatsService`,
  `TrashService`, `IntegrityService`, `RecentService`, `ActivityService`,
  `noopActivityRecorder`
- Types: `FileRecord`, `FolderRecord`, `FileVersionRecord`, `ActivityEventRecord`,
  `ActivityRecorder`, `FileDownload`, `FolderMutationResult`,
  `IntegrityCheckOptions`, `EngineResolver`, `UserRecord`, `DomainError`

Telegram integration (server-side only):

- `TelegramClientManager`, `TelegramConnectionService`,
  `TelegramStorageProvider`, `mapTelegramError`, `TELEGRAM_PROVIDER`
- Types: `ConnectionStatus`, `TelegramCredentials`, `TelegramStorageOptions`

Shared vocabulary and query helpers:

- `ERROR_CODES`, `fileCategory`, `isFileCategory`, `mimeFromFilename`,
  `mimeMatchersForType`, `parseSearchQuery`, `parseSize`, `paginationMeta`
- DTO and enum types including `FileDTO`, `FolderDTO`, `FileVersionDTO`,
  `ActivityEventDTO`, `StorageStatsDTO`, `StorageHealthDTO`, `HealthDTO`,
  `IntegrityReportDTO`, `BatchResultDTO`, `SessionInfo`, `ListQuery`,
  `PaginationDTO`, `SortField`, `SortOrder`, `ItemStatus`, `ErrorCode`,
  `ApiErrorBody`, `ConnectionState`, `HealthStatus`, `UserDTO`, `StorageDTO`.

Because `TelegramClientManager` and the Telegram provider require a live
MTProto connection, import them only in server code. `OmniCloudClient` and the
shared types are safe in any runtime.
