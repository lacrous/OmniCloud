# HTTP API reference (v0.2)

All endpoints are served under `/api` by the Fastify application in
`apps/api`. The API is JSON (request/response) except for file uploads, which
are `multipart/form-data`, and downloads, which stream raw bytes.

Every request runs through the same middleware chain (in order):

1. **Request id** — taken from the inbound `x-request-id` header (1–128
   characters) or generated as a UUID; echoed on the response and included in
   every error body.
2. **Security headers** — a fixed set of baseline headers (see
   [security.md](./security.md)).
3. **Origin check** — state-changing requests (`POST`, `PUT`, `PATCH`,
   `DELETE`) must come from an allowed origin (see [CSRF](#cross-origin-and-csrf)).
4. **Authentication** — every `/api` route requires a session except
   `/api/auth/*` and `/api/health*`.
5. **Route → service → repository → storage provider**, with activity events
   recorded as a side effect of mutations.
6. **Error handler** — maps domain errors to structured responses.

> Records owned by another user are answered with `404` (`FILE_NOT_FOUND` /
> `FOLDER_NOT_FOUND` / `NOT_FOUND`), never `403`, so their existence is not
> leaked.

---

## Conventions

### Error envelope

Every non-2xx response (except gateway-generated failures on the static file
path) has this shape:

```json
{
  "error": {
    "code": "FILE_NOT_FOUND",
    "message": "File not found",
    "requestId": "3f1c2b9e-...",
    "details": null
  }
}
```

- `code` — one of the stable machine-readable codes in the
  [Error codes](#error-codes) table.
- `message` — human-readable, safe to display. Telegram credential/session
  material is never included.
- `requestId` — correlates the response with server logs.
- `details` — present only for some errors (for example the raw Telegram
  error code in `TELEGRAM_CONNECTION_FAILED`).

The TypeScript shape is `ApiErrorBody` in `packages/shared/src/index.ts`.

### Request id

| Header         | Direction          | Notes                                                   |
| -------------- | ------------------ | ------------------------------------------------------- |
| `x-request-id` | request (optional) | Honored when 1–128 chars; otherwise a UUID is generated |
| `x-request-id` | response (always)  | Echoes the effective request id                         |

Use it when reporting a problem: the same value appears in the structured
logs.

### Authentication

The browser session is an httpOnly, SameSite=Lax cookie named
`omnicloud_session` (constant `SESSION_COOKIE`). It carries a signed JWT whose
subject is the OmniCloud user id and expires after 30 days.

The Telegram MTProto session is **never** sent to clients; it is stored
server-side only. Bearer tokens are not implemented server-side — the SDK's
`token` option is only useful against deployments that put token auth in front
of the API.

### Pagination

Every listing endpoint returns a pagination envelope:

```json
{ "page": 1, "limit": 50, "total": 123, "hasMore": true }
```

| Field     | Meaning                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------- |
| `page`    | 1-based page number. Invalid values fall back to `1`.                                                 |
| `limit`   | Page size. Invalid values fall back to `50` (`DEFAULT_PAGE_SIZE`); capped at `200` (`MAX_PAGE_SIZE`). |
| `total`   | Total matching items. For combined file+folder listings this is the sum of both totals.               |
| `hasMore` | `page * limit < total`.                                                                               |

### Sorting and filtering

Shared by `GET /api/files`, `GET /api/folders`, `GET /api/trash`,
`GET /api/starred`:

| Parameter | Type     | Values                                           | Notes                                                                                  |
| --------- | -------- | ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `page`    | integer  | ≥ 1                                              | Default `1`                                                                            |
| `limit`   | integer  | 1–200                                            | Default `50`                                                                           |
| `sort`    | string   | `name`, `size`, `createdAt`, `updatedAt`, `type` | Unknown values are ignored                                                             |
| `order`   | string   | `asc`, `desc`                                    | Default `asc`                                                                          |
| `status`  | string   | `active`, `trashed`, `all`                       | Default `active`; unknown values fall back to `active`                                 |
| `q`       | string   | —                                                | Case-insensitive name substring filter                                                 |
| `type`    | string   | category or MIME type                            | `image`, `video`, `audio`, `pdf`, `archive`, `document`, `text`, or an exact MIME type |
| `ext`     | string   | extension without dot                            | `zip`, `pdf`                                                                           |
| `starred` | boolean  | `true`/`false` (`1`/`0` accepted)                |                                                                                        |
| `minSize` | integer  | bytes, ≥ 0                                       |                                                                                        |
| `maxSize` | integer  | bytes, ≥ 0                                       |                                                                                        |
| `from`    | ISO date | —                                                | Inclusive lower bound on `createdAt`                                                   |
| `to`      | ISO date | —                                                | Inclusive upper bound on `createdAt`                                                   |

Notes:

- `sort=size` and `sort=type` apply to files; folder sorting falls back to
  name for those fields.
- `sort=name` is the default; unknown `sort`/`order` values are ignored rather
  than rejected.
- `type=other` matches nothing usable and is ignored.
- Blank/unknown query string values are ignored; the request is not rejected.

### Batch operations

`POST /api/files/batch` and `POST /api/folders/batch` accept 1–500 unique ids
and return per-item results. A bad item does not abort the batch:

```json
{
  "requested": 3,
  "succeeded": 2,
  "failed": 1,
  "errors": [{ "id": "cuid_...", "code": "INVALID_REQUEST", "message": "File not found" }]
}
```

`code` in batch errors is always `INVALID_REQUEST`; `message` carries the
per-item reason.

### Cross-origin and CSRF

For `POST`/`PUT`/`PATCH`/`DELETE`:

- If `ALLOWED_ORIGINS` is set, the request's `Origin` must exactly match one of
  the listed origins.
- Otherwise the origin's host must equal the request `Host` header
  (same-origin), unless the `Origin` header is absent.
- Requests with **no** `Origin` header (curl, server-to-server SDK) are
  permitted.

A rejected cross-origin request returns `403 PERMISSION_DENIED`.

### Search query language

`GET /api/search?q=...` accepts a tokenized query (maximum 200 characters).
Tokens are space-separated; unknown `field:value` tokens fall back to free
text.

| Token                            | Meaning                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `report`                         | Free text; case-insensitive name substring                                                                                            |
| `name:report`, `filename:report` | Explicit name filter                                                                                                                  |
| `type:pdf`                       | Coarse category (`image`, `video`, `audio`, `pdf`, `archive`, `document`, `text`)                                                     |
| `type:application/pdf`           | Exact MIME type                                                                                                                       |
| `ext:zip`, `extension:zip`       | Filename extension (leading dot optional)                                                                                             |
| `size:>100MB`                    | Size comparison: `>`, `>=`, `<`, `<=`, `=`. Units `b`, `kb`, `mb`, `gb`, `tb` (implicit bytes). A bare `size:5mb` means exactly 5 MB. |
| `folder:Projects`                | Restricts to files/folders inside folders whose name contains `Projects`                                                              |
| `starred:true`                   | Starred only (`true`/`1`/`yes`/`y`/`on`, `false`/`0`/`no`/`n`/`off`)                                                                  |
| `trashed:true`                   | Trashed only; `trashed:false` (aliases `deleted:`) means active only                                                                  |
| `after:2026-01-01`, `since:...`  | Inclusive lower date bound                                                                                                            |
| `before:2026-06-01`              | Inclusive upper date bound (plain dates mean end of that UTC day)                                                                     |

Behavior:

- Search covers **both active and trashed** items unless the query narrows the
  scope with `trashed:`.
- Results include both files and folders, each paginated with the same
  `page`/`limit`; the envelope's `total` is the combined count.
- `type:`/`size:` filters only affect files; folders have no MIME type or size.
- An empty `q` returns `400 INVALID_REQUEST`.

---

## Health

Public; no session required. Useful for uptime monitoring and load-balancer
probes.

### `GET /api/health`

```json
{
  "status": "healthy",
  "database": "healthy",
  "storage": "unknown",
  "uptimeSeconds": 3600,
  "version": "0.2.0"
}
```

`status` mirrors `database`. `storage` is reported as `unknown` here because the
storage backend is per-user; use `GET /api/storage/health` for the signed-in
user's storage. `database` is `healthy` or `unavailable`.

### `GET /api/health/database`

```json
{ "status": "healthy", "database": "healthy" }
```

A cheap query proves PostgreSQL connectivity without loading data.

---

## Auth

The login flow talks to Telegram via MTProto (user API) as described in
[telegram.md](./telegram.md). The three login endpoints are rate limited to
**10 requests per minute per IP**; exceeding that returns `429 RATE_LIMITED`.

### `POST /api/auth/telegram/start`

Sends the Telegram confirmation code to the phone number.

```json
{ "phone": "+15551234567" }
```

`phone` must match `^\+?[0-9]\d{4,14}$` (5–15 digits, optional leading `+`).

Response `200`:

```json
{ "ok": true }
```

Errors: `400 INVALID_REQUEST` (bad phone), `429 RATE_LIMITED`,
`502 TELEGRAM_CONNECTION_FAILED`, `400 INVALID_REQUEST` for Telegram
phone-number rejections (`PHONE_NUMBER_INVALID`, `PHONE_NUMBER_UNOCCUPIED`),
`403 PERMISSION_DENIED` for `PHONE_NUMBER_BANNED`.

### `POST /api/auth/telegram/verify`

Checks the confirmation code. `code` must match `^\d{3,10}$`.

```json
{ "phone": "+15551234567", "code": "12345" }
```

Response `200` when 2FA is **disabled** — sets the session cookie:

```json
{
  "status": "ok",
  "user": { "id": "cuid_...", "username": "jane", "firstName": "Jane", "lastName": null }
}
```

Response `200` when 2FA is **enabled** — no cookie yet:

```json
{ "status": "password_required" }
```

On the first successful sign-in the private storage channel is created (this
may take a few seconds). Errors: `400 INVALID_REQUEST` (bad code,
`PHONE_CODE_INVALID`, `PHONE_CODE_EXPIRED`, `PHONE_CODE_EMPTY`), `404 NOT_FOUND`
(no pending login for this phone), `400 INVALID_REQUEST` (login flow older than
5 minutes), `429 RATE_LIMITED`.

### `POST /api/auth/telegram/password`

Completes sign-in for 2FA accounts.

```json
{ "phone": "+15551234567", "password": "••••••" }
```

Response `200` — sets the session cookie:

```json
{
  "status": "ok",
  "user": { "id": "cuid_...", "username": "jane", "firstName": "Jane", "lastName": null }
}
```

Errors: `400 INVALID_REQUEST` (`PASSWORD_HASH_INVALID`), `404 NOT_FOUND` (no
pending login), `429 RATE_LIMITED`.

### `GET /api/auth/me`

Public. Returns nulls when signed out. When signed in, returns the user, their
storage registration and a light storage health snapshot (no Telegram
round-trip, so it is fast and reflects the cached connection state):

```json
{
  "user": { "id": "cuid_...", "username": "jane", "firstName": "Jane", "lastName": null },
  "storage": {
    "id": "cuid_...",
    "provider": "telegram",
    "title": "OmniCloud Storage",
    "createdAt": "2026-08-01T10:00:00.000Z"
  },
  "health": {
    "provider": "telegram",
    "state": "CONNECTED",
    "status": "healthy",
    "latencyMs": null,
    "message": null,
    "channelTitle": "OmniCloud Storage",
    "checkedAt": "2026-08-01T10:00:05.000Z"
  }
}
```

Signed out: `{ "user": null, "storage": null, "health": null }`. If `user` is
set but `storage` is `null`, call `POST /api/storage/ensure`.

### `POST /api/auth/logout`

Drops the server-side Telegram connection (if any), clears the session cookie
and returns `{ "ok": true }`. It does **not** revoke the Telegram session —
that must be done from Telegram Settings → Devices.

---

## Storage

All storage endpoints require a session except the health probes above.

### `POST /api/storage/ensure`

Creates the user's private Telegram storage channel if it does not already
exist (idempotent). Safe to call repeatedly.

```json
{
  "storage": {
    "id": "cuid_...",
    "provider": "telegram",
    "title": "OmniCloud Storage",
    "createdAt": "2026-08-01T10:00:00.000Z"
  }
}
```

Errors: `409 STORAGE_NOT_INITIALIZED`, `401 TELEGRAM_AUTH_REQUIRED`,
`502 TELEGRAM_CONNECTION_FAILED`.

### `GET /api/storage/health`

Returns the current storage health and the statistics snapshot in one call
(used by the dashboard).

```json
{
  "health": {
    "provider": "telegram",
    "state": "CONNECTED",
    "status": "healthy",
    "latencyMs": null,
    "message": null,
    "channelTitle": "OmniCloud Storage",
    "checkedAt": "2026-08-01T10:00:05.000Z"
  },
  "stats": {
    "fileCount": 42,
    "folderCount": 7,
    "totalBytes": 734003200,
    "trashBytes": 1048576,
    "trashFileCount": 2,
    "starredCount": 5,
    "byType": [{ "category": "image", "bytes": 524288000, "count": 20 }],
    "largestFiles": [],
    "quotaBytes": null
  }
}
```

`state` is one of `DISCONNECTED`, `CONNECTING`, `CONNECTED`, `RECONNECTING`,
`ERROR`, `AUTH_REQUIRED`. `status` is `healthy`, `degraded`, `unavailable` or
`unknown`.

### `POST /api/storage/health/check`

Forces a fresh probe. Body is optional.

```json
{ "deep": true }
```

- `deep: false` (default) — cheap: connection state plus a cached probe result
  (cached for 30 seconds).
- `deep: true` — performs a real Telegram round-trip (`getMe`).

Response:

```json
{
  "health": {
    "provider": "telegram",
    "state": "CONNECTED",
    "status": "healthy",
    "latencyMs": 84,
    "message": null,
    "channelTitle": "OmniCloud Storage",
    "checkedAt": "2026-08-01T10:00:05.000Z"
  }
}
```

### `GET /api/storage/stats`

Computes the dashboard statistics from PostgreSQL metadata only — no Telegram
round-trips, so it works even while Telegram is unreachable.

```json
{
  "stats": {
    "fileCount": 42,
    "folderCount": 7,
    "totalBytes": 734003200,
    "trashBytes": 1048576,
    "trashFileCount": 2,
    "starredCount": 5,
    "byType": [
      { "category": "image", "bytes": 524288000, "count": 20 },
      { "category": "video", "bytes": 200000000, "count": 3 }
    ],
    "largestFiles": [/* up to 10 FileDTO, largest first */],
    "quotaBytes": null
  }
}
```

`byType` uses the coarse categories from `fileCategory()` and is sorted by
bytes descending. `quotaBytes` is `null` unless `STORAGE_QUOTA_GB` is set.

### `POST /api/storage/integrity/check`

Read-only drift check between PostgreSQL metadata and Telegram storage. A JSON
body is required.

```json
{ "deep": false }
```

- `deep: false` — checks that each message exists and its size matches the
  metadata (`stat` only).
- `deep: true` — additionally downloads and re-hashes every file (slow, but
  authoritative).

Response:

```json
{
  "report": {
    "checkedAt": "2026-08-01T10:01:00.000Z",
    "filesChecked": 40,
    "healthy": 38,
    "missing": 1,
    "inconsistent": 1,
    "unreadable": 0,
    "issues": [
      {
        "fileId": "cuid_...",
        "name": "report.pdf",
        "kind": "missing",
        "detail": "No message with this id exists in the storage channel"
      },
      {
        "fileId": "cuid_...",
        "name": "archive.zip",
        "kind": "size_mismatch",
        "detail": "metadata=1048576 storage=0"
      }
    ],
    "durationMs": 812
  }
}
```

Issue kinds:

| Kind            | Meaning                                                          |
| --------------- | ---------------------------------------------------------------- |
| `missing`       | Metadata exists, the Telegram message is gone                    |
| `size_mismatch` | Stored object size differs from the metadata                     |
| `hash_mismatch` | Deep mode only: downloaded bytes do not match the stored SHA-256 |
| `unreadable`    | The provider errored while inspecting the object                 |

The checker is strictly read-only: it never repairs, deletes or rewrites
anything.

---

## Files

### `GET /api/files`

Lists and/or filters active files. Query parameters are the shared
[pagination/sorting/filtering](#sorting-and-filtering) set.

| Parameter                                                         | Notes                                                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `folderId`                                                        | Scopes to a folder. **Presence matters**: omit it to span every folder; send it empty (`folderId=`) to scope to the root. |
| `page`, `limit`, `sort`, `order`                                  | See above                                                                                                                 |
| `status`                                                          | Default `active`                                                                                                          |
| `q`, `type`, `ext`, `starred`, `minSize`, `maxSize`, `from`, `to` | See above                                                                                                                 |

```json
{
  "files": [
    {
      "id": "cuid_...",
      "name": "report.pdf",
      "size": 1048576,
      "mimeType": "application/pdf",
      "sha256": "8e1c...e4",
      "folderId": null,
      "starred": false,
      "trashed": false,
      "deletedAt": null,
      "versionCount": 1,
      "currentVersionId": "cuid_...",
      "createdAt": "2026-08-01T10:00:00.000Z",
      "updatedAt": "2026-08-01T10:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 1, "hasMore": false }
}
```

### `POST /api/files`

Uploads a file. `multipart/form-data` with:

| Part       | Type             | Notes                                                                   |
| ---------- | ---------------- | ----------------------------------------------------------------------- |
| `file`     | file (required)  | Exactly one file part. The multipart filename is used as the file name. |
| `folderId` | field (optional) | Target folder id; empty/absent = root                                   |

Response `201`:

```json
{
  "file": {
    "id": "cuid_...",
    "name": "report.pdf",
    "size": 1048576,
    "mimeType": "application/pdf",
    "sha256": "8e1c...e4",
    "folderId": null,
    "starred": false,
    "trashed": false,
    "deletedAt": null,
    "versionCount": 1,
    "currentVersionId": "cuid_...",
    "createdAt": "2026-08-01T10:00:00.000Z",
    "updatedAt": "2026-08-01T10:00:00.000Z"
  }
}
```

Notes:

- The multipart `files` limit is 1 and the parts limit is 10.
- The MIME type is derived server-side from the filename extension; any
  client-supplied MIME type is ignored.
- Every upload also creates version 1, so `versionCount` is `1` and
  `currentVersionId` is set immediately.
- Metadata is persisted only after the Telegram upload succeeds.
- A body larger than `MAX_UPLOAD_MB` returns `413 PAYLOAD_TOO_LARGE`. The
  provider additionally rejects documents above Telegram's 2 GB limit with
  `502 UPLOAD_FAILED`.
- Errors: `400 INVALID_REQUEST` (missing file/name), `404 FOLDER_NOT_FOUND`,
  `409 CONFLICT` (target folder is trashed), `413 PAYLOAD_TOO_LARGE`,
  `502 UPLOAD_FAILED`.

### `GET /api/files/:id`

Returns `{ "file": FileDTO }`.

Errors: `404 FILE_NOT_FOUND` (missing, trashed state is not filtered here, or
owned by another user).

### `GET /api/files/:id/versions`

Returns the file's version history, newest first.

```json
{
  "versions": [
    {
      "id": "cuid_...",
      "fileId": "cuid_...",
      "versionNumber": 2,
      "size": 2097152,
      "mimeType": "application/pdf",
      "sha256": "91ab...22",
      "telegramMessageId": 4021,
      "isCurrent": true,
      "createdAt": "2026-08-02T09:00:00.000Z"
    }
  ]
}
```

`isCurrent` is true for the file's `currentVersionId`. Errors:
`404 FILE_NOT_FOUND`.

### `GET /api/files/:id/download`

Streams the file bytes. Only **active** files can be downloaded; a trashed file
returns `404 FILE_NOT_FOUND`.

Response headers:

| Header                 | Value                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `Content-Type`         | The stored MIME type                                                                                            |
| `Content-Length`       | Byte length                                                                                                     |
| `Content-Disposition`  | `attachment` with ASCII and RFC 5987 (`filename*=UTF-8''...`) forms                                             |
| `X-Content-SHA256`     | The stored SHA-256                                                                                              |
| `X-Integrity-Verified` | `true`/`false` — comparison of the downloaded bytes with the stored hash; a mismatch is also logged server-side |

Errors: `404 FILE_NOT_FOUND`, `502 DOWNLOAD_FAILED`,
`401 TELEGRAM_AUTH_REQUIRED`.

### `POST /api/files/:id/replace`

Uploads a new version of an existing file and makes it current.
`multipart/form-data` with a single `file` part (the filename becomes the new
name). The file's folder is preserved.

Response `200`: `{ "file": FileDTO }` with an incremented `versionCount` and a
new `currentVersionId`.

Errors: `404 FILE_NOT_FOUND`, `413 PAYLOAD_TOO_LARGE`, `502 UPLOAD_FAILED`.

### `PATCH /api/files/:id`

Renames and/or stars a file. At least one field is required.

```json
{ "name": "renamed.pdf", "starred": true }
```

Response: `{ "file": FileDTO }`.

Errors: `400 INVALID_REQUEST` (neither field, or invalid name), `404
FILE_NOT_FOUND`.

### `POST /api/files/:id/move`

Moves a file into a folder, or to the root with `null`.

```json
{ "folderId": "cuid_..." }
```

```json
{ "folderId": null }
```

Response: `{ "file": FileDTO }`. Errors: `400 INVALID_REQUEST`,
`404 FILE_NOT_FOUND`, `404 FOLDER_NOT_FOUND`, `409 CONFLICT` (target folder is
trashed).

### `POST /api/files/:id/trash`

Soft-deletes a file (moves it to the Trash). The Telegram object is untouched,
so restore is lossless. Idempotent: re-trashing returns the record unchanged.

Response: `{ "file": FileDTO }` with `trashed: true` and `deletedAt` set.
Errors: `404 FILE_NOT_FOUND`.

### `POST /api/files/:id/restore`

Restores a trashed file. If its original folder is gone or itself trashed, the
file is restored to the root so it can never be orphaned.

Response: `{ "file": FileDTO }`. Errors: `404 FILE_NOT_FOUND`.

### `DELETE /api/files/:id`

**Permanently deletes** the file: the current Telegram message (and any older
version messages) is removed first, then the metadata. Response `204 No
Content`.

> This is a permanent operation. Use `POST /api/files/:id/trash` first if you
> want a recoverable step. If the remote delete fails, the metadata is kept so
> the operation can be retried.

Errors: `404 FILE_NOT_FOUND`, `502` (mapped provider error),
`401 TELEGRAM_AUTH_REQUIRED`.

### `POST /api/files/batch`

Applies one operation to many files.

```json
{ "operation": "trash", "ids": ["cuid_...", "cuid_..."] }
```

Move operations take an optional destination:

```json
{ "operation": "move", "ids": ["cuid_..."], "folderId": null }
```

| Field       | Values                                                 |
| ----------- | ------------------------------------------------------ |
| `operation` | `trash`, `restore`, `delete`, `star`, `unstar`, `move` |
| `ids`       | 1–500 unique, non-empty string ids                     |
| `folderId`  | Only for `move`; string or `null` (root)               |

Response: the [batch result](#batch-operations). A `move` with an invalid
target folder fails the whole batch with `404 FOLDER_NOT_FOUND` / `409
CONFLICT`; other per-item failures are reported in `errors`.

---

## Folders

Folders are virtual OmniCloud objects with a parent-child hierarchy; they have
no physical representation on Telegram.

### `GET /api/folders`

Two modes:

- **No scope filters** (`parentId`, `status`, `q`, `starred` all absent) —
  returns the direct active children of the root, with a pagination envelope
  whose `limit`/`total` equal the number of folders.
- **With filters** — the shared [query set](#sorting-and-filtering), where
  `parentId` is an alias for the folder scope (`parentId` empty = root; omit
  it to span every folder).

```json
{
  "folders": [
    {
      "id": "cuid_...",
      "name": "Documents",
      "parentId": null,
      "starred": false,
      "trashed": false,
      "deletedAt": null,
      "createdAt": "2026-08-01T10:00:00.000Z",
      "updatedAt": "2026-08-01T10:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 1, "hasMore": false }
}
```

Errors: `404 FOLDER_NOT_FOUND` (invalid scope folder).

### `GET /api/folders/tree`

Returns every active folder for the user as a flat list (used by move dialogs).

```json
{ "folders": [/* FolderDTO[] */] }
```

No pagination. Trashed folders are excluded.

### `POST /api/folders`

```json
{ "name": "Documents", "parentId": null }
```

`parentId` is optional and defaults to `null` (root). Response `201`:
`{ "folder": FolderDTO }`.

Errors: `400 INVALID_REQUEST` (bad name), `404 FOLDER_NOT_FOUND` (invalid
parent), `409 CONFLICT` (parent is trashed).

### `PATCH /api/folders/:id`

Renames and/or stars a folder. At least one field is required.

```json
{ "name": "New name", "starred": true }
```

Response: `{ "folder": FolderDTO }`. Errors: `400 INVALID_REQUEST`,
`404 FOLDER_NOT_FOUND`.

### `POST /api/folders/:id/move`

Moves a folder under a new parent, or to the root with `null`.

```json
{ "parentId": "cuid_..." }
```

Response: `{ "folder": FolderDTO }`.

Errors: `400 INVALID_REQUEST` (moving into itself or one of its descendants),
`404 FOLDER_NOT_FOUND`, `409 CONFLICT` (target is trashed).

### `POST /api/folders/:id/trash`

Moves the folder **and its entire subtree** (folders and files) to the Trash.
Nothing is deleted from Telegram, so restore is lossless. Everything moved by
this one operation is stamped with a shared trash batch id.

Response:

```json
{ "affectedFolders": 3, "affectedFiles": 12 }
```

Errors: `404 FOLDER_NOT_FOUND`.

### `POST /api/folders/:id/restore`

Restores the folder subtree. Only nodes trashed **together with the folder**
(the same batch) are restored; anything the user trashed separately stays in
the Trash. If the parent chain is still trashed, the folder is restored to the
root.

Response:

```json
{ "affectedFolders": 3, "affectedFiles": 12 }
```

Errors: `404 FOLDER_NOT_FOUND`.

### `DELETE /api/folders/:id`

**Permanently deletes** the folder subtree: files' Telegram objects are removed
first, then file metadata, then folder rows. Folders that still contain a file
whose remote delete failed are kept so the operation can be retried.

```json
{ "affectedFolders": 3, "affectedFiles": 12 }
```

Errors: `404 FOLDER_NOT_FOUND`, `502` (mapped provider error),
`401 TELEGRAM_AUTH_REQUIRED`.

### `POST /api/folders/batch`

Same shape and semantics as the file batch endpoint, with `parentId` as the
move target.

```json
{ "operation": "move", "ids": ["cuid_..."], "parentId": null }
```

Response: the [batch result](#batch-operations).

---

## Collections

### `GET /api/trash`

Lists everything currently in the Trash across all folders (the `folderId`
scope is intentionally ignored). Supports `page`/`limit` and the name/size/type
filters; `status` is forced to `trashed`.

```json
{
  "files": [/* FileDTO[] with trashed: true */],
  "folders": [/* FolderDTO[] with trashed: true */],
  "pagination": { "page": 1, "limit": 50, "total": 14, "hasMore": false }
}
```

Files and folders are each paginated with the same `page`/`limit`; `total` is
the combined count.

### `POST /api/trash/empty`

Permanently removes everything in the Trash. Remote Telegram objects are
deleted first; files whose remote delete fails are **left in the Trash** and
reported in `failedFiles` so the operation can be retried.

```json
{ "deletedFiles": 12, "deletedFolders": 5, "failedFiles": 1 }
```

Errors: `401 TELEGRAM_AUTH_REQUIRED`, `502` (mapped provider error).

### `GET /api/starred`

Lists starred files and folders (across all folders). Supports the shared
query set; `starred` is forced to `true` and only **active** items are
returned (`status` defaults to `active`).

```json
{
  "files": [/* FileDTO[] */],
  "folders": [/* FolderDTO[] */],
  "pagination": { "page": 1, "limit": 50, "total": 5, "hasMore": false }
}
```

### `GET /api/recent`

The most recently touched **active** files, newest activity first. Only these
actions count: `upload`, `download`, `open`, `rename`, `move`, `replace`.
Trashed and permanently deleted files are filtered out.

```json
{
  "items": [
    {
      "file": {
        "id": "cuid_...",
        "name": "report.pdf",
        "size": 1048576,
        "mimeType": "application/pdf",
        "sha256": "8e1c...e4",
        "folderId": null,
        "starred": false,
        "trashed": false,
        "deletedAt": null,
        "versionCount": 1,
        "currentVersionId": "cuid_...",
        "createdAt": "2026-08-01T10:00:00.000Z",
        "updatedAt": "2026-08-01T10:00:00.000Z"
      },
      "lastAction": "download",
      "lastActionAt": "2026-08-01T11:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 1, "hasMore": false }
}
```

Only `page` and `limit` are read. `lastAction` is one of the
`ACTIVITY_ACTIONS` values.

### `GET /api/search`

Full endpoint for the [search query language](#search-query-language).

| Parameter       | Notes                          |
| --------------- | ------------------------------ |
| `q` (required)  | Query string, ≤ 200 characters |
| `page`, `limit` | Pagination                     |

```json
{
  "files": [/* FileDTO[] */],
  "folders": [/* FolderDTO[] */],
  "pagination": { "page": 1, "limit": 50, "total": 4, "hasMore": false }
}
```

By default search covers active **and** trashed items. Errors:
`400 INVALID_REQUEST` (empty or too-long `q`).

### `GET /api/activity`

Newest-first activity feed. Only `page` and `limit` are read.

```json
{
  "events": [
    {
      "id": "cuid_...",
      "action": "upload",
      "resourceType": "file",
      "resourceId": "cuid_...",
      "resourceName": "report.pdf",
      "metadata": { "size": 1048576, "mimeType": "application/pdf" },
      "createdAt": "2026-08-01T10:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 1, "hasMore": false }
}
```

`action` is one of: `upload`, `download`, `open`, `rename`, `move`, `star`,
`unstar`, `trash`, `restore`, `delete`, `create_folder`, `replace`.
`resourceType` is `file`, `folder` or `storage`. `metadata` is sanitized:
credential-shaped keys (matching `password`, `secret`, `token`, `session`,
`hash`, `credential`) are stripped before storage.

---

## Error codes

Every code below is a value of `ERROR_CODES` in
`packages/shared/src/index.ts`; the HTTP status comes from the corresponding
error class in `packages/core/src/errors.ts`.

| Code                         | HTTP | Typical cause                                                                      |
| ---------------------------- | ---- | ---------------------------------------------------------------------------------- |
| `INVALID_REQUEST`            | 400  | Validation failure (bad body, field, enum, batch ids)                              |
| `AUTH_REQUIRED`              | 401  | No session cookie on a protected route                                             |
| `AUTH_INVALID`               | 401  | Invalid/expired session token, or the account no longer exists                     |
| `PERMISSION_DENIED`          | 403  | Cross-origin state-changing request rejected; banned Telegram phone                |
| `NOT_FOUND`                  | 404  | Generic missing resource; unknown route; no pending Telegram login                 |
| `FILE_NOT_FOUND`             | 404  | File missing or owned by another user                                              |
| `FOLDER_NOT_FOUND`           | 404  | Folder missing or owned by another user                                            |
| `CONFLICT`                   | 409  | Operation targets a folder that is in the Trash                                    |
| `PAYLOAD_TOO_LARGE`          | 413  | Upload exceeds `MAX_UPLOAD_MB` or the multipart limit                              |
| `RATE_LIMITED`               | 429  | Auth limiter (10/min/IP) or Telegram `FLOOD_WAIT_n`                                |
| `STORAGE_NOT_INITIALIZED`    | 409  | No storage registration / channel missing (`CHANNEL_PRIVATE`, `CHAT_ID_INVALID`)   |
| `STORAGE_UNAVAILABLE`        | 503  | Storage backend reachable but failing                                              |
| `TELEGRAM_AUTH_REQUIRED`     | 401  | Telegram session revoked/expired (`AUTH_KEY_UNREGISTERED`, `SESSION_REVOKED`, ...) |
| `TELEGRAM_CONNECTION_FAILED` | 502  | Telegram unreachable or unknown RPC/network failure                                |
| `TELEGRAM_FILE_NOT_FOUND`    | 404  | Message missing (`MSG_ID_INVALID`) or file reference expired                       |
| `UPLOAD_FAILED`              | 502  | Upload failed at the storage layer                                                 |
| `DOWNLOAD_FAILED`            | 502  | Download failed at the storage layer                                               |
| `INTEGRITY_CHECK_FAILED`     | 502  | Integrity verification failed                                                      |
| `INTERNAL_ERROR`             | 500  | Unhandled server error                                                             |

Additional notes:

- Client cancellation surfaces as code `INVALID_REQUEST` with the non-standard
  status `499` (`OperationCancelledError`).
- `StorageProviderError` is deprecated and maps to
  `TELEGRAM_CONNECTION_FAILED` (502).
- Fastify's own body/upload-too-large errors are normalized to
  `PAYLOAD_TOO_LARGE` (413).
- Any Fastify error with a `statusCode` is returned with that status and code
  `INVALID_REQUEST`.
