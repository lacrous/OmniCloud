# HTTP API reference (v0.1)

All endpoints are prefixed with `/api`. Authentication uses an httpOnly
session cookie (`omnicloud_session`) issued after the Telegram login flow.
Every request is associated with a user; users can only ever access their own
files, folders and storage.

Errors use a stable envelope:

```json
{ "error": { "code": "NOT_FOUND", "message": "File not found" } }
```

Common codes: `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401),
`FORBIDDEN` (403), `NOT_FOUND` (404), `PAYLOAD_TOO_LARGE` (413),
`RATE_LIMITED` (429), `STORAGE_NOT_INITIALIZED` (409), `TELEGRAM_ERROR` (502),
`INTERNAL_ERROR` (500).

> Records belonging to another user are answered with `404`, not `403`, to
> avoid leaking their existence.

---

## Authentication

The login flow talks to Telegram via MTProto (user API). The Telegram session
itself is stored server-side; the browser only ever holds the OmniCloud
session cookie.

### `POST /api/auth/telegram/start`

Sends the Telegram confirmation code.

```json
{ "phone": "+15551234567" }
```

Response: `{ "ok": true }`. Rate limited to 10 requests/minute per IP.

### `POST /api/auth/telegram/verify`

Checks the confirmation code.

```json
{ "phone": "+15551234567", "code": "12345" }
```

Response (2FA disabled):

```json
{ "status": "ok", "user": { "id": "…", "username": "…", "firstName": "…", "lastName": null } }
```

Sets the session cookie. Also creates the private storage channel on first
login (may take a few seconds).

Response (2FA enabled): `{ "status": "password_required" }` — continue with
the password endpoint.

### `POST /api/auth/telegram/password`

Completes sign-in for accounts with two-factor authentication.

```json
{ "phone": "+15551234567", "password": "••••••" }
```

Response: `{ "status": "ok", "user": { … } }`, sets the session cookie.

### `GET /api/auth/me`

Public. Returns `{ "user": null, "storage": null }` when signed out; otherwise
the user and their storage registration:

```json
{
  "user": { "id": "…", "username": "jane", "firstName": "Jane", "lastName": null },
  "storage": { "id": "…", "provider": "telegram", "title": "OmniCloud Storage", "createdAt": "…" }
}
```

If `storage` is `null` while `user` is set, call
`POST /api/storage/ensure` to create the storage channel.

### `POST /api/auth/logout`

Clears the session cookie. Response: `{ "ok": true }`.

---

## Storage

### `POST /api/storage/ensure`

Creates the user's private Telegram storage channel if it does not exist
(idempotent). Response: `{ "storage": { … } }`.

---

## Files

### `POST /api/files`

Uploads a file. `multipart/form-data` with a `file` part and an optional
`folderId` string field (absent/empty = upload to root).

Response `201`:

```json
{
  "file": {
    "id": "…",
    "name": "test.pdf",
    "size": 1024,
    "mimeType": "application/pdf",
    "sha256": "8e1c…",
    "folderId": "…",
    "createdAt": "…",
    "updatedAt": "…"
  }
}
```

Notes:

- The MIME type is derived server-side from the filename extension; client-supplied MIME types are ignored.
- Metadata is only persisted after the Telegram upload succeeds.
- Sizes above `MAX_UPLOAD_MB` are rejected with `413 PAYLOAD_TOO_LARGE`.

### `GET /api/files?folderId=…`

Lists files in a folder (omit `folderId` for the root).
Response: `{ "files": [FileDTO] }`.

### `GET /api/files/:id`

File metadata. Response: `{ "file": FileDTO }`.

### `GET /api/files/:id/download`

Downloads the original bytes. Headers: `Content-Type`, `Content-Length`,
`Content-Disposition` (attachment), `X-Content-SHA256` and
`X-Integrity-Verified` (`true`/`false` — a mismatch is logged server-side).

### `PATCH /api/files/:id`

Renames a file. Body: `{ "name": "new-name.pdf" }`. Response: `{ "file": FileDTO }`.

### `POST /api/files/:id/move`

Moves a file. Body: `{ "folderId": "…or null for root" }`. Response: `{ "file": FileDTO }`.

### `DELETE /api/files/:id`

Deletes a file (metadata **and** the Telegram message holding the content).
Response: `204 No Content`.

---

## Folders

Folders are virtual OmniCloud objects with a parent-child hierarchy.
Deleting a folder recursively deletes all descendant folders, the files
inside them and their Telegram objects.

### `POST /api/folders`

`{ "name": "Documents", "parentId": "…or null for root" }` → `201 { "folder": FolderDTO }`

### `GET /api/folders?parentId=…`

Lists direct children of a folder (omit `parentId` for root).
Response: `{ "folders": [FolderDTO] }`.

### `GET /api/folders/tree`

All of the user's folders flattened (for tree views).
Response: `{ "folders": [FolderDTO] }`.

### `PATCH /api/folders/:id`

Rename. `{ "name": "New name" }` → `{ "folder": FolderDTO }`.

### `POST /api/folders/:id/move`

Move a folder (root: `"parentId": null`). Moving a folder into itself or one
of its descendants returns `400 VALIDATION_ERROR`. → `{ "folder": FolderDTO }`.

### `DELETE /api/folders/:id`

Recursive delete. Response:

```json
{ "deletedFolders": 2, "deletedFiles": 5 }
```

---

## Search

### `GET /api/search?q=…`

Case-insensitive substring search over file and folder names.
Response:

```json
{ "files": [FileDTO], "folders": [FolderDTO] }
```
