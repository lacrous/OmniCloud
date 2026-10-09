# Troubleshooting

Symptom → cause → fix for OmniCloud v0.2. Every error body carries a stable
`code` and a `requestId`; start by matching the code, then use the request id to
find the correlating log line.

## First steps: the request id

Every response has an `x-request-id` header, and every error body includes the
same value as `requestId`:

```json
{ "error": { "code": "TELEGRAM_AUTH_REQUIRED", "message": "...", "requestId": "3f1c2b9e-..." } }
```

The API logs structured JSON with request ids. To find the matching lines:

```bash
# adjust to your log sink; with docker/systemd, grep the service output
journalctl -u omnicloud --since "10 min ago" | grep 3f1c2b9e
```

The SDK stores the id on `OmniCloudError.requestId`; include it when reporting a
problem.

## Telegram and storage

### "Telegram account is not connected" / `TELEGRAM_AUTH_REQUIRED`

**Cause.** The stored MTProto session is no longer valid: the device was
removed in Telegram, the account was deactivated, or Telegram returned
`AUTH_KEY_UNREGISTERED`, `AUTH_KEY_DUPLICATED`, `SESSION_REVOKED`,
`SESSION_EXPIRED`, `USER_DEACTIVATED` or `USER_DEACTIVATED_BAN`.

**Fix.** The user must sign in again through the
`/api/auth/telegram/start` → `verify` → (optional) `password` flow. Confirm the
new session works with `POST /api/storage/health/check` `{ "deep": true }`. Check
Telegram Settings → Devices to see whether an old device was removed.

### `USER_DEACTIVATED` / repeated `AUTH_KEY_DUPLICATED` on every call

**Cause.** The same Telegram session is being used from more than one place, or
the account is deactivated. `AUTH_KEY_DUPLICATED` typically means two MTProto
clients are sharing one auth key.

**Fix.** Run a **single API process** per Telegram account. Ensure only one
OmniCloud instance (plus the user's own Telegram apps) uses the session. If the
account is deactivated, no server-side fix is possible — the user must restore
the account with Telegram.

### `STORAGE_NOT_INITIALIZED` (409)

**Cause.** There is no `Storage` row for the user, or the channel is
unreachable/invalid — Telegram returned `CHANNEL_PRIVATE`, `CHANNEL_INVALID` or
`CHAT_ID_INVALID`. This commonly happens if the "OmniCloud Storage" channel was
deleted in Telegram.

**Fix.** Call `POST /api/storage/ensure` to create the channel (idempotent).
Confirm with `GET /api/auth/me`: `storage` should be non-null and `health`
should progress to `CONNECTED`. If the channel was deleted, `ensure` creates a
new one, but it will **not** re-upload existing content — files whose messages
lived in the old channel are permanently gone and will show as `missing` in an
integrity report.

### `STORAGE_UNAVAILABLE` (503) / `TELEGRAM_CONNECTION_FAILED` (502)

**Cause.** The server could not reach Telegram, or an unrecognized RPC/network
failure occurred. Messages matching `timeout`, `ECONNRESET`, `ENOTFOUND`,
`socket`, `network` or `connect` are reported as `TELEGRAM_CONNECTION_FAILED`.

**Fix.**

1. Check outbound network/DNS/firewall from the host to Telegram.
2. Retry the operation — the `StorageEngine` already retries transient failures
   three times with backoff, so a failure here means it exhausted those
   attempts.
3. Run `POST /api/storage/health/check` `{ "deep": true }` and read `health.message`.
4. If the errors are persistent and non-transient, they may be mapped as a
   generic connection failure for an RPC error not in the mapping table; inspect
   the `details` field (it carries the Telegram error code).

### Rate limits: `RATE_LIMITED` (429) / `FLOOD_WAIT_n`

**Cause.** Telegram answered with `FLOOD_WAIT_n`, which OmniCloud maps to
`429 RATE_LIMITED` with a message like "retry in n seconds". The engine does
**not** retry `FLOOD_WAIT`, because retrying makes it worse.

**Fix.** Wait the indicated number of seconds before retrying. Reduce request
frequency (large batch operations, repeated deep health checks, or integrity
scans can each consume Telegram budget). Note this is distinct from OmniCloud's
own auth limiter (10/min/IP), which also returns `429 RATE_LIMITED` with a
"too many attempts" message.

### Upload returns `413 PAYLOAD_TOO_LARGE`

**Cause.** The uploaded file exceeds `MAX_UPLOAD_MB` (default 256) or the
multipart limit. Fastify's body/upload too-large errors are normalized to this
code.

**Fix.** Raise `MAX_UPLOAD_MB` (an integer number of megabytes) and restart.
Remember the provider's own ceiling: Telegram rejects documents above 2 GB with
`502 UPLOAD_FAILED`. Uploads are written to a temporary directory on disk, not
held in memory, so a higher limit needs free disk space in that directory rather
than more RAM. Check that space before raising the limit.

### Upload returns `502 UPLOAD_FAILED`

**Cause.** The storage upload failed after the engine's retries. Possible
reasons: the document exceeds 2 GB, the Telegram client is not connected, a
transient transport failure, or a `FILE_REFERENCE_*` issue.

**Fix.** Check `message`/`details`; run a deep storage health check; confirm the
file size is under both `MAX_UPLOAD_MB` and 2 GB; retry.

### Integrity check reports `missing`, `size_mismatch`, `hash_mismatch` or `unreadable`

`POST /api/storage/integrity/check` is **read-only** — it never repairs,
deletes or re-uploads anything. Each kind means:

| Kind            | Meaning                                                                                                     | Practical response                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `missing`       | Metadata exists but the Telegram message is gone (channel deleted, message deleted manually, wrong channel) | The bytes are unrecoverable. Restore from a backup that includes the original content, or delete the broken record. |
| `size_mismatch` | The stored document's size differs from `File.size`                                                         | Indicates metadata/storage drift. Deep-check to see whether the bytes also fail hashing. Do not delete blindly.     |
| `hash_mismatch` | Deep mode: downloaded bytes do not match the stored SHA-256                                                 | Data corruption or a replaced message. Treat the content as untrusted.                                              |
| `unreadable`    | The provider errored while inspecting the object                                                            | Usually transient (network/rate limit). Re-run the check before concluding anything.                                |

If many files are `missing` at once, suspect the channel itself (deleted or
recreated). Repairs are a deliberate, separate operation — verify with a
non-deep check first, and investigate thoroughly before deleting metadata.

## Trash

### Items remain in the Trash after "Empty Trash"

**Cause.** `POST /api/trash/empty` deletes remote Telegram objects first and
only removes metadata for the files whose remote delete succeeded. Files whose
delete failed are counted in `failedFiles` and **left in the Trash** so no data
is silently lost.

**Fix.** Read `failedFiles` in the response. If it is greater than `0`, the
underlying issue is usually a transient Telegram failure or the session being
invalid; resolve that (see the Telegram section), then call empty-trash again.
Folders that still contain such files are intentionally kept as well, so they
reappear until their contents are removed.

### A trashed folder's restore does not bring back everything

**Cause.** Restore is scoped to the **trash batch**: only nodes trashed together
with the folder (sharing its `trashBatchId`) are restored. Items the user
trashed separately stay in the Trash by design.

**Fix.** Restore those items individually. If a folder's parent was still
trashed, it is restored to the root rather than to a hidden parent; move it back
after restoring the parent.

### Deleting a file returns an error instead of deleting

**Cause.** Permanent delete removes the Telegram object before the metadata; if
the remote delete fails, the metadata is kept so the operation can be retried,
and a storage error propagates instead of a false success.

**Fix.** Resolve the storage error (connectivity/session), then retry. The file
is still present, which is the intended safe behavior.

## Sessions and authentication

### 401 loop / `AUTH_INVALID`

**Cause.** The session cookie does not match a live browser session. Usual
reasons: the session was signed out (logout or "sign out everywhere"), it expired
after 30 days, the cookie was cleared, the database was restored to an older
state, or the account row no longer exists.

**Fix.** Sign in again. Sessions are stored in the database, so restarting the
API does not sign anyone out. Restoring an older database does, for sessions
created after the backup.

### Auth endpoints return `429 RATE_LIMITED` immediately

**Cause.** The auth rate limiter allows 10 requests/minute per IP. Behind a
reverse proxy without `TRUST_PROXY=true`, all clients share the proxy's IP and
exhaust the shared budget.

**Fix.** Set `TRUST_PROXY=true` so client IPs are derived from
`X-Forwarded-For`. Wait out the window for the immediate 429.

### `403 PERMISSION_DENIED` on a POST/PATCH/DELETE

**Cause.** The state-changing request's `Origin` failed the allowlist check. If
`ALLOWED_ORIGINS` is set, the `Origin` must match exactly; otherwise the origin
host must equal the request `Host`. Non-browser clients with no `Origin` header
are permitted, so curl usually works while a browser from the wrong origin does
not.

**Fix.** Either add the UI's full origin to `ALLOWED_ORIGINS`
(`https://cloud.example`, no trailing slash) or serve the UI from the same
origin. Ensure the proxy forwards the correct `Host` header.

### `404 NOT_FOUND` on `/api/auth/me`-adjacent flows

`GET /api/auth/me` is public and returns `{ "user": null, ... }` instead of an
error. A `404` from `POST /api/auth/telegram/verify` or `/password` means there
is no pending login for that phone — the flow was never started, was cancelled,
or expired (pending flows live for 5 minutes and are in-memory, so a restart or
a different process also loses them). Start the login again.

## Build, database and serving

### `prisma generate` errors

**Symptoms.** `@prisma/client did not initialize yet`, missing generated types,
or type errors referencing `PrismaClient`.

**Cause.** The generated client is out of date or absent (for example after a
clean checkout, a branch switch, or a schema change).

**Fix.**

```bash
pnpm db:generate
```

`postinstall` runs this automatically, but run it explicitly after editing
`packages/database/prisma/schema.prisma` or after dependency changes. If it
still fails, ensure `DATABASE_URL` is syntactically valid — `prisma generate`
itself does not need a live database, but a malformed URL can still trip it.

### Migration errors

**Symptoms.** `prisma migrate deploy` fails, or the app starts with "table does
not exist" errors.

**Cause.** Migrations were not applied, or the database schema drifted from the
migration history.

**Fix.**

```bash
pnpm db:migrate   # prisma migrate deploy
```

This applies `0_init`, `1_v02_reliability` and `2_v02_trash_batch` in order. If
the database was modified outside migrations, `migrate deploy` will report a
divergence; reconcile the schema (or, in development only, reset it). Always
take a backup before applying migrations to a database with real data. After a
v0.1 → v0.2 upgrade, verify the version backfill succeeded:

```sql
SELECT count(*) FROM "File" WHERE "versionCount" = 0;
SELECT count(*) FROM "FileVersion";
```

### `WEB_DIST_DIR` and SPA 404s

**Symptoms.** The root URL returns JSON `404 NOT_FOUND`, or deep links (for
example `/folders/abc`) return JSON instead of the app.

**Cause.** `WEB_DIST_DIR` is unset, points at a missing directory, or the API
was started before the web app was built. The static handler is only registered
when the directory exists.

**Fix.** Build the web app, point `WEB_DIST_DIR` at the build output directory,
and restart. Confirm the directory contains `index.html`. With SPA serving
enabled, unhandled `GET` requests outside `/api/` return `index.html`; unknown
`/api/` routes and non-GET requests still return JSON `404`.

### API exits at startup with a config error

**Symptoms.** `TELEGRAM_API_ID and TELEGRAM_API_HASH are required` or
`OMNICLOUD_ENCRYPTION_KEY must be set when NODE_ENV=production`.

**Cause.** `loadConfig` validates required settings and throws before the server
listens.

**Fix.** Set the missing variables. `TELEGRAM_API_ID` must be a non-zero
integer and `TELEGRAM_API_HASH` non-empty; in production
`OMNICLOUD_ENCRYPTION_KEY` must be set (generate it with `openssl rand -hex 32`). Also check `PORT`, `MAX_UPLOAD_MB` and `STORAGE_QUOTA_GB` are positive
integers/numbers, since `int()` throws on invalid values.

## Health probes cheat sheet

| Endpoint                            | Auth    | What it tells you                                                              |
| ----------------------------------- | ------- | ------------------------------------------------------------------------------ |
| `GET /api/health`                   | none    | Process up, database reachable, version, uptime                                |
| `GET /api/health/database`          | none    | Database only                                                                  |
| `GET /api/auth/me`                  | none    | Whether the caller has a session; light storage state (no Telegram round-trip) |
| `GET /api/storage/health`           | session | Cached storage health plus statistics                                          |
| `POST /api/storage/health/check`    | session | Fresh probe; `{ "deep": true }` does a real Telegram round-trip                |
| `POST /api/storage/integrity/check` | session | Read-only drift report (use `{ "deep": true }` to re-hash bytes)               |
| `POST /api/storage/ensure`          | session | Creates the storage channel if missing                                         |
