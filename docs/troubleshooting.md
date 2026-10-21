# Troubleshooting

Symptom → cause → fix. Every entry starts with the text you would type into
a search box or copy out of the app, so you can find the entry that matches.

Every error body carries a stable `code` and a `requestId`. Match the code
first, then use the request id to find the correlating log line.

## Contents

- [First steps: the request id](#first-steps-the-request-id)
- [Telegram and storage](#telegram-and-storage)
- [Files, uploads and integrity](#files-uploads-and-integrity)
- [Trash](#trash)
- [Sessions and access](#sessions-and-access)
- [The `omnicloud` CLI and the npm package](#the-omnicloud-cli-and-the-npm-package)
- [Build, database and serving](#build-database-and-serving)
- [Encryption and recovery](#encryption-and-recovery)
- [The update check](#the-update-check)
- [Health and diagnostics cheat sheet](#health-and-diagnostics-cheat-sheet)

## First steps: the request id

Every response has an `x-request-id` header, and every error body includes
the same value as `requestId`:

```json
{
  "error": {
    "code": "TELEGRAM_AUTH_REQUIRED",
    "message": "Telegram account is not connected",
    "requestId": "3f1c2b9e-…"
  }
}
```

The API logs structured JSON with request ids. To find the matching lines:

```bash
# adjust to your log sink; with docker/systemd, grep the service output
journalctl -u omnicloud --since "10 min ago" | grep 3f1c2b9e
```

The SDK stores the id on `OmniCloudError.requestId`; include it when
reporting a problem.

The `code` values are stable and machine-readable:

| Code                         | Status | Meaning                                                                               |
| ---------------------------- | ------ | ------------------------------------------------------------------------------------- |
| `AUTH_REQUIRED`              | 401    | No session or API token on the request                                                |
| `AUTH_INVALID`               | 401    | The session exists but is no longer valid                                             |
| `PERMISSION_DENIED`          | 403    | Origin check failed, or the resource is not yours                                     |
| `INVALID_REQUEST`            | 400    | The request body failed validation                                                    |
| `NOT_FOUND`                  | 404    | No such route or resource                                                             |
| `FILE_NOT_FOUND`             | 404    | No such file                                                                          |
| `FOLDER_NOT_FOUND`           | 404    | No such folder                                                                        |
| `CONFLICT`                   | 409    | The request conflicts with the current state                                          |
| `PAYLOAD_TOO_LARGE`          | 413    | The upload exceeds the configured limit                                               |
| `RATE_LIMITED`               | 429    | Rate limit, from OmniCloud or from Telegram                                           |
| `STORAGE_NOT_INITIALIZED`    | 409    | No storage channel for this account                                                   |
| `STORAGE_UNAVAILABLE`        | 503    | The storage backend is reachable but failing                                          |
| `TELEGRAM_AUTH_REQUIRED`     | 401    | The stored Telegram session needs to be re-established                                |
| `TELEGRAM_CONNECTION_FAILED` | 502    | Telegram could not be reached                                                         |
| `TELEGRAM_FILE_NOT_FOUND`    | 404    | The object is gone from Telegram                                                      |
| `UPLOAD_FAILED`              | 502    | The upload failed. A storage-layer failure during a download is reported the same way |
| `DOWNLOAD_FAILED`            | 502    | Defined in `packages/core/src/errors.ts`, but never thrown and not exported           |
| `INTEGRITY_CHECK_FAILED`     | 502    | The bytes did not match the recorded checksum                                         |
| `INTERNAL_ERROR`             | 500    | An unhandled server error                                                             |

## Telegram and storage

### "Could not start Telegram sign-in" / "Could not start Telegram QR sign-in"

**Cause.** The server could not open an MTProto connection to Telegram, or
Telegram did not issue a login token. The error is
`502 TELEGRAM_CONNECTION_FAILED` with the underlying reason in `details`.
Usual causes: no outbound network access to Telegram, a firewall that blocks
MTProto, or an invalid `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` pair.

**Fix.**

1. Check outbound connectivity from the server host, not from your laptop:

   ```bash
   curl -sS -o /dev/null -w "%{http_code}\n" https://api.telegram.org
   ```

2. Confirm `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` match the application at
   <https://my.telegram.org>. `TELEGRAM_API_ID` must be a non-zero integer
   and `TELEGRAM_API_HASH` must be the 32-character value from that page.
3. Restart the server after changing them, then retry the sign-in.
4. If the server is behind an egress proxy, make sure the proxy allows the
   MTProto ports, not only HTTPS.

### "Could not draw the QR code. Use the phone form below."

**Cause.** The browser could not render the QR image from the `tg://login`
token. The token itself was issued by Telegram; only the rendering failed.

**Fix.**

1. Use the phone-number form on the same page. It signs in through the same
   Telegram session and produces the same result.
2. Reload the page to get a fresh token. Telegram rotates the token every few
   seconds and expires it quickly.
3. If the form also fails, see
   ["Could not start Telegram sign-in"](#could-not-start-telegram-sign-in--could-not-start-telegram-qr-sign-in).

### "This Telegram QR sign-in has ended. Start again." / "The QR sign-in expired. Start again."

**Cause.** The QR flow is gone from the server's memory. Flows live for five
minutes (`QR_FLOW_TTL_MS`), are held in memory rather than in the database,
and are lost whenever the process restarts. The first message is a
`404 NOT_FOUND`, the second a `400 INVALID_REQUEST`.

**Fix.**

1. Scan the code again, or reload the page to start a new flow.
2. Approve it in Telegram promptly: **Settings → Devices → Link Desktop
   Device**, then scan. Telegram expires the token on its own schedule.
3. If the flow keeps expiring, sign in with the phone number and code
   instead. That flow has the same five-minute lifetime.

### "Telegram is reconnecting. Retrying shortly."

**Cause.** A poll of the QR status failed while the token was being
refreshed. The web app clears the message and retries on its own. A transient
Telegram error during the refresh is expected occasionally.

**Fix.**

1. Wait. The page retries on its own every few seconds.
2. If it never clears, reload the page to start a fresh flow.
3. If it repeats on every attempt, check the server log for the underlying
   Telegram error and confirm outbound connectivity.

### "Telegram requires a password before issuing a QR login token"

**Cause.** The Telegram account has two-factor authentication enabled. The QR
token exchange is rejected until the account password is supplied, and this
happens before the QR flow can start.

**Fix.**

1. Sign in with the phone-number form instead: it asks for the code and then
   the two-factor password.
2. If the phone form also stops at
   `Two-factor authentication is enabled on this account`, that is the
   expected answer — the next step asks for the password.

### "Telegram account is not connected" / `TELEGRAM_AUTH_REQUIRED`

**Cause.** The stored MTProto session is no longer valid: the device was
removed in Telegram, the account was deactivated, or Telegram returned
`AUTH_KEY_UNREGISTERED`, `AUTH_KEY_DUPLICATED`, `SESSION_REVOKED`,
`SESSION_EXPIRED`, `USER_DEACTIVATED` or `USER_DEACTIVATED_BAN`. The status
is `401` with the message "Telegram account is not connected" or "Your
Telegram session has expired — please reconnect".

**Fix.**

1. Sign in again through the `/api/auth/telegram/start` → `verify` →
   (optional) `password` flow, or with the QR code on the login page.
2. Confirm the new session works with
   `POST /api/storage/health/check` and `{ "deep": true }`.
3. Check Telegram **Settings → Devices** to see whether an old device was
   removed. Removing the device there is what invalidates the session.

> **Note:** this code is a storage reconnect signal, not a lost browser
> session. The web app does not sign you out for it.

### `AUTH_KEY_DUPLICATED` on every call, or `USER_DEACTIVATED`

**Cause.** The same Telegram session is being used from more than one place,
or the account is deactivated. `AUTH_KEY_DUPLICATED` typically means two
MTProto clients are sharing one auth key.

**Fix.**

1. Run a **single API process** per Telegram account. Ensure only one
   OmniCloud instance (plus the user's own Telegram apps) uses the session.
2. Check Telegram **Settings → Devices** for a second session you did not
   create, and terminate it.
3. If the account is deactivated, no server-side fix is possible — the user
   must restore the account with Telegram.

### "Storage is not initialized for this account" / `STORAGE_NOT_INITIALIZED` (409)

**Cause.** There is no `Storage` row for the user, or the stored channel
reference is stale — Telegram returned `CHANNEL_PRIVATE`, `CHANNEL_INVALID`,
`CHAT_ID_INVALID` or `PEER_ID_INVALID`. This commonly happens if the
"OmniCloud Storage" channel was deleted in Telegram.

**Fix.**

1. Call `POST /api/storage/ensure` to create the channel. It is idempotent.
2. Confirm with `GET /api/auth/me`: `storage` should be non-null and `health`
   should progress to `CONNECTED`.
3. If the channel was deleted, `ensure` creates a **new** one, but it will
   **not** re-upload existing content. Files whose messages lived in the old
   channel are permanently gone and show as `missing` in an integrity report
   and as `dangling` in a reconciliation report.

### "Could not reach Telegram" / `TELEGRAM_CONNECTION_FAILED` (502) / "Storage is temporarily unavailable" / `STORAGE_UNAVAILABLE` (503)

**Cause.** The server could not reach Telegram, or an unrecognized RPC or
network failure occurred. Messages matching `timeout`, `ECONNRESET`,
`ENOTFOUND`, `socket`, `network` or `connect` are reported as
`TELEGRAM_CONNECTION_FAILED` with "(network error)" appended.

**Fix.**

1. Check outbound network, DNS and firewall access from the host to
   Telegram.
2. Retry the operation. The `StorageEngine` already retries transient
   failures three times with backoff, so a failure here means it exhausted
   those attempts.
3. Run `POST /api/storage/health/check` with `{ "deep": true }` and read
   `health.message`.
4. If the errors are persistent and non-transient, they may be mapped as a
   generic connection failure for an RPC error that is not in the mapping
   table. Inspect the `details` field — it carries the Telegram error code.

### "Telegram rate limit reached — retry in N seconds" / `RATE_LIMITED` (429)

**Cause.** Telegram answered with a flood wait. OmniCloud maps it to
`429 RATE_LIMITED` and does **not** retry, because retrying makes it worse.

**Fix.**

1. Wait the indicated number of seconds before retrying.
2. Reduce request frequency. Large batch operations, repeated deep health
   checks and integrity scans each consume Telegram budget.
3. Note this is distinct from OmniCloud's own auth limiter (10 requests per
   minute per IP), which returns `429 RATE_LIMITED` with the message "Too
   many attempts — try again in 60 seconds". See
   [Auth endpoints are rate limited](#auth-endpoints-are-rate-limited).

## Files, uploads and integrity

### "The uploaded file is too large" / `PAYLOAD_TOO_LARGE` (413)

**Cause.** The upload exceeds `MAX_UPLOAD_MB` (default 256). Fastify's
multipart and body-size errors are normalised to this code, and the message
is either "The uploaded file is too large" or "Files larger than N MB are
not supported".

**Fix.**

1. Raise `MAX_UPLOAD_MB` to an integer number of megabytes and restart the
   server. It must be a positive integer; `0` is rejected at startup.
2. Remember the provider's own ceiling: the Telegram provider rejects a
   document larger than 2 GB with "Telegram does not accept documents larger
   than 2 GB" (`502 UPLOAD_FAILED`), which is a different error from the
   server's own size cap.
3. Uploads are written to a temporary directory on disk, not held in memory,
   so a higher limit needs free space in that directory rather than more
   RAM. Check `df -h` on `TMPDIR` before raising it.

> **Note:** a reverse proxy in front of the API may reject the body before
> OmniCloud sees it. nginx's default `client_max_body_size` is 1 MB, so a
> proxy that does not raise it produces its own `413`. See
> [deployment.md](deployment.md#reverse-proxy).

### "Upload failed" / `UPLOAD_FAILED` (502)

**Cause.** The storage upload failed after the engine's retries. Possible
reasons: the document exceeds Telegram's 2 GB limit ("Telegram does not
accept documents larger than 2 GB"), the Telegram client is not connected, a
transient transport failure, or a `FILE_REFERENCE_*` issue.

**Fix.**

1. Read `message` and `details` in the error body.
2. Confirm the file size is under both `MAX_UPLOAD_MB` and 2 GB.
3. Run a deep storage health check
   (`POST /api/storage/health/check` with `{ "deep": true }`).
4. Retry. If the client reuses the same operation id (`Idempotency-Key`
   header or `operationId` field), the retry finds the object that may
   already have been stored rather than uploading it twice.

### "The stored file is missing from Telegram" / `TELEGRAM_FILE_NOT_FOUND` (404)

**Cause.** The record points at a Telegram message that no longer exists.
Telegram returned `MSG_ID_INVALID` or `MESSAGE_ID_INVALID`. The usual cause
is that the message was deleted from the channel, or the channel was
replaced.

**Fix.**

1. Run `POST /api/storage/integrity/check` to confirm the scope of the
   problem. The report kind is `missing`.
2. Look for the message in the "OmniCloud Storage" channel in Telegram. If it
   is gone, the bytes are gone: restore from a backup that includes the
   original content, or delete the broken record.
3. If many files are `missing` at once, suspect the channel itself — it was
   probably deleted and recreated. `POST /api/storage/ensure` creates a new
   channel but does not bring the old messages back.

### "The Telegram file reference expired — re-upload the file to refresh it"

**Cause.** Telegram returned `FILE_REFERENCE_EXPIRED` or
`FILE_REFERENCE_INVALID`. The reference Telegram uses to address a stored
file has a limited lifetime. The bytes are still in the channel; the pointer
to them is what went stale.

**Fix.**

1. Upload the file again. A new upload creates a new message with a fresh
   reference.
2. Re-upload and then delete the stale record, so the file list matches what
   the channel actually holds.

### "Downloaded content does not match its checksum" / `INTEGRITY_CHECK_FAILED` (502)

**Cause.** The bytes that came back from Telegram do not hash to the SHA-256
recorded for the file. The download is verified against the stored checksum
before its final bytes are released, so a corrupt object ends the transfer
instead of completing with bad data.

**Fix.**

1. Do not trust the downloaded content. Treat it as untrusted.
2. Run `POST /api/storage/integrity/check` with `{ "deep": true }` to
   re-hash the stored object. A `hash_mismatch` confirms the drift; an
   `unreadable` result usually means a transient network or rate-limit
   failure, so run it again before concluding anything.
3. Re-upload the file from a known-good copy if you have one.
4. Check the Telegram channel for the message: a `hash_mismatch` can mean the
   message was replaced, not just corrupted.

### The integrity report says `missing`, `size_mismatch`, `hash_mismatch` or `unreadable`

`POST /api/storage/integrity/check` is **read-only** — it never repairs,
deletes or re-uploads anything. Each kind means:

| Kind            | Meaning                                                                                            | Practical response                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `missing`       | Metadata exists but the Telegram message is gone (channel deleted, message deleted, wrong channel) | The bytes are unrecoverable. Restore from a backup that includes the original content, or delete the broken record. |
| `size_mismatch` | The stored document's size differs from `File.size`                                                | Indicates metadata/storage drift. Deep-check to see whether the bytes also fail hashing. Do not delete blindly.     |
| `hash_mismatch` | Deep mode only: the downloaded bytes do not match the stored SHA-256                               | Data corruption or a replaced message. Treat the content as untrusted.                                              |
| `unreadable`    | The provider errored while inspecting the object                                                   | Usually transient (network or rate limit). Re-run the check before concluding anything.                             |

If many files are `missing` at once, suspect the channel itself (deleted or
recreated). Repairs are a deliberate, separate operation: run
`POST /api/storage/reconciliation/plan` to see what it proposes, then
`POST /api/storage/reconciliation/apply` with the ids you approve.

### "… is too large to preview. Download it instead."

**Cause.** The web app refuses to preview files above 64 MiB
(`PREVIEW_MAX_BYTES` in the web client's download module). It is a preview
limit, not an upload or storage limit.

**Fix.**

1. Download the file instead of previewing it.
2. The download is streamed and verified against the stored checksum, so it
   works for files of any size the server accepts.

### The Storage page shows "100% of quota used" but uploads still succeed

**Cause.** `STORAGE_QUOTA_GB` is a display ceiling, not an enforcement. It is
passed to the stats service and drawn on the Storage dashboard; nothing
rejects an upload for exceeding it. The page shows "No quota set on this
account." when the variable is unset or `0`.

**Fix.**

1. Raise `STORAGE_QUOTA_GB` and restart the server if you want the meter to
   reflect reality. It is a number of gigabytes, and `0` means no quota.
2. To actually cap usage, enforce it outside OmniCloud, or monitor
   `totalBytes` from `GET /api/storage/stats` and alert on it.

### "Could not reach the server. Check your connection and try again."

**Cause.** The browser could not complete the `fetch` at all — no HTTP
response, so there is no status code and no `requestId`. The API is not
listening on the address the browser used, the browser is talking to the
wrong host, or something between the browser and the API dropped the
connection (TLS failure, proxy, firewall).

**Fix.**

1. Check the API from the same machine the browser is on:

   ```bash
   curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4000/api/health/live
   ```

   A `200` means the API is healthy and the problem is between the browser
   and the proxy.

2. If the curl fails too, the API is not running or is on another port.
   Check `PORT` and the service state, and read the log for
   `listen EADDRINUSE` — see
   [The port is already in use](#the-port-is-already-in-use-eaddrinuse).
3. If the curl succeeds but the browser does not, check the reverse proxy:
   the `Host` header, the TLS certificate, and whether the proxy forwards to
   the port the API actually listens on.
4. If the browser was opened before the server started, reload. The CLI
   waits for `/api/health` before it opens the browser, so this usually
   points at a proxy problem rather than a startup race.
5. Check that the URL in the browser is the one you meant. The CLI opens
   `127.0.0.1` when `HOST` is `0.0.0.0`; a remote browser cannot reach
   `127.0.0.1` on the server.

## Trash

### Items remain in the Trash after "Empty Trash"

**Cause.** `POST /api/trash/empty` deletes remote Telegram objects first and
only removes metadata for the files whose remote delete succeeded. Files
whose delete failed are counted in `failedFiles` and **left in the Trash** so
no data is silently lost.

**Fix.**

1. Read `failedFiles` in the response. If it is greater than `0`, the
   underlying issue is usually a transient Telegram failure or an invalid
   session.
2. Resolve that first — see [Telegram and storage](#telegram-and-storage).
3. Call empty-trash again. Folders that still contain such files are
   intentionally kept as well, so they reappear until their contents are
   removed.

### A trashed folder's restore does not bring back everything

**Cause.** Restore is scoped to the **trash batch**: only nodes trashed
together with the folder (sharing its `trashBatchId`) are restored. Items
the user trashed separately stay in the Trash by design.

**Fix.**

1. Restore those items individually.
2. If a folder's parent was still trashed, it is restored to the root rather
   than to a hidden parent. Move it back after restoring the parent.

### Deleting a file returns an error instead of deleting

**Cause.** Permanent delete removes the Telegram object before the metadata.
If the remote delete fails, the metadata is kept so the operation can be
retried, and a storage error propagates instead of a false success.

**Fix.**

1. Resolve the storage error (connectivity or session), then retry. The file
   is still present, which is the intended safe behaviour.
2. Check `POST /api/storage/health/check` with `{ "deep": true }` if the
   error does not name a cause.

## Sessions and access

### "Your session is no longer valid — please sign in again" / `AUTH_INVALID` (401)

**Cause.** The session cookie does not match a live browser session. Usual
reasons: the session was signed out (logout or "sign out everywhere"), it
expired after 30 days (`DEFAULT_SESSION_TTL_DAYS`), the cookie was cleared,
the database was restored to an older state, or the account row no longer
exists.

**Fix.**

1. Sign in again.
2. Sessions are stored in the database, so restarting the API does not sign
   anyone out. Restoring an older database does, for sessions created after
   the backup.

### Auth endpoints are rate limited

**Cause.** The auth rate limiter allows 10 requests per minute per IP.
Behind a reverse proxy without `TRUST_PROXY=true`, every client shares the
proxy's IP and exhausts the shared budget. The message is "Too many attempts
— try again in 60 seconds".

**Fix.**

1. Set `TRUST_PROXY=true` so client IPs are derived from
   `X-Forwarded-For`, and make sure the proxy actually sets that header.
2. Wait out the window for the immediate `429`. The limiter is in memory and
   resets on restart.

### "Cross-origin request rejected" / `PERMISSION_DENIED` (403)

**Cause.** The state-changing request's `Origin` failed the allow-list
check. If `ALLOWED_ORIGINS` is set, the `Origin` must match it exactly;
otherwise the origin host must equal the request `Host`. Non-browser clients
with no `Origin` header are permitted, so curl usually works while a
browser from the wrong origin does not.

**Fix.**

1. Add the UI's full origin to `ALLOWED_ORIGINS` (`https://cloud.example`, no
   trailing slash), or serve the UI from the same origin as the API.
2. Ensure the proxy forwards the correct `Host` header. Without it, the
   same-origin fallback compares the wrong host.
3. Check for a trailing slash or a port in the configured origin: the
   comparison is exact.

### `404 NOT_FOUND` on `/api/auth/telegram/verify` or `/api/auth/telegram/password`

**Cause.** There is no pending login for that phone number. The flow was
never started, was cancelled, or expired: pending flows live for five
minutes and are held in memory, so a restart or a different process also
loses them. The message is "No pending Telegram login for this phone
number".

**Fix.**

1. Start the login again: `POST /api/auth/telegram/start`, then `verify`,
   then `password` if the account has two-factor authentication.
2. Do not restart the server between `start` and `verify` — the pending flow
   lives in the process's memory.

> **Note:** `GET /api/auth/me` is public and returns `{ "user": null, … }`
> when you are signed out. It does not return an error.

## The `omnicloud` CLI and the npm package

### `omnicloud: command not found`

**Cause.** The command is installed into the project's `node_modules/.bin`,
so it is not on your shell `PATH` unless you add it.

**Fix.**

1. Run it with `npx omnicloud` from the project directory.
2. Or add a script to `package.json` (`"start": "omnicloud"`) and run
   `npm run start`.

### "omnicloud: no configuration found. Create <path>"

**Cause.** `omnicloud start` found no `.env` in the working directory and no
`DATABASE_URL` in the environment, and the process was not attached to a
terminal, so the interactive first-run setup could not run.

**Fix.**

1. Create the `.env` file yourself. The variables are `DATABASE_URL`,
   `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` and `OMNICLOUD_ENCRYPTION_KEY`.
2. Run `omnicloud` in an interactive terminal once to let the setup wizard
   write the file for you.
3. Point at a different file with `omnicloud start --env /path/to/file.env`.

### "omnicloud: DATABASE_URL is not set. Add it to your environment or .env file."

**Cause.** `omnicloud` and `omnicloud start` need `DATABASE_URL`, and the
command reads it from the environment or from `.env` in the current
directory.

**Fix.**

1. Add `DATABASE_URL` to `.env`, or pass `--env <file>` to point at a
   different file.
2. Variables already set in your shell take precedence over the file.

### "omnicloud: Database migration failed (exit 1)."

**Cause.** `prisma migrate deploy` failed. The Prisma error is printed
above the CLI line: "Can't reach database server at … Please make sure your
database server is running" (`P1001`) when PostgreSQL is down or the host and
port are wrong, or "Authentication failed against database server, the
provided database credentials for `…` are not valid" (`P1000`) when the
credentials are wrong. A divergence error or a failed statement also lands
here.

**Fix.**

1. Start PostgreSQL, and check the host, port, user and password in
   `DATABASE_URL`.
2. Confirm the database accepts the connection:

   ```bash
   psql "$DATABASE_URL" -c "select 1"
   ```

3. Check the `_prisma_migrations` table for a failed entry. Prisma records a
   failed migration and refuses to continue until it is resolved:

   ```sql
   SELECT migration_name, logs, rolled_back_at
     FROM "_prisma_migrations"
    WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;
   ```

4. If the schema was changed outside the migration history, `migrate deploy`
   reports a divergence. Reconcile it by hand; do not reset a production
   database.
5. Take a backup before retrying against a database with real data.

### "omnicloud: The server bundle is missing. Reinstall @hilbras/omnicloud."

**Cause.** The package's `server/` directory is absent or incomplete. The
CLI looks for `server/index.js` before it starts anything.

**Fix.**

1. Reinstall the package:

   ```bash
   npm install @hilbras/omnicloud@0.5.0
   ```

2. Confirm the bundle is there:

   ```bash
   ls node_modules/@hilbras/omnicloud/server
   ```

   It must contain `index.js`, `web/` and `prisma/`.

3. If the install came from a cache or an offline mirror, clear it and
   reinstall.

### The port is already in use (EADDRINUSE)

**Cause.** Another process already holds the port. The server logs
`Failed to start` with the error

```
listen EADDRINUSE: address already in use 0.0.0.0:4000
```

and exits with status `1`; under the CLI the message becomes
`omnicloud: Server exited with code 1.` The address in the message is the
one the server tried to bind, so it names the `HOST` and `PORT` in effect.

**Fix.**

1. Find the process that holds the port:

   ```bash
   ss -ltnp | grep :4000
   ```

2. Stop it, or move OmniCloud to another port with `PORT=4001`.
3. If the other process is an old OmniCloud instance, stop the service
   instead of starting a second one. Two processes sharing one Telegram
   account cause `AUTH_KEY_DUPLICATED`.

### "Error: TELEGRAM_API_ID and TELEGRAM_API_HASH are required."

**Cause.** The server validates the configuration before it listens, and
these two are mandatory. The message is printed by the server process as it
starts; the CLI then reports `omnicloud: Server exited with code 1.`

**Fix.**

1. Set both, from the application you created at
   <https://my.telegram.org>.
2. `TELEGRAM_API_ID` must be a non-zero integer. `TELEGRAM_API_HASH` must be
   the 32-character value from the same page.
3. Restart the server.

### "Error: OMNICLOUD_ENCRYPTION_KEY must be set when NODE_ENV=production"

**Cause.** The `omnicloud` command sets `NODE_ENV=production`, and
production requires the key that seals the stored Telegram sessions.

**Fix.**

1. Generate one and keep it:

   ```bash
   openssl rand -hex 32
   ```

2. Put it in the environment or in `.env` as `OMNICLOUD_ENCRYPTION_KEY`.
3. Back it up separately from the database. Losing it makes the stored
   Telegram sessions unreadable; see
   [Encryption and recovery](#encryption-and-recovery).

### "Error: PORT must be a positive integer"

**Cause.** The same message appears for `MAX_UPLOAD_MB` and
`TELEGRAM_API_ID`. The value is missing a number, is not an integer, or is
`0`.

**Fix.**

1. Set the variable to a positive whole number.
2. `PORT` defaults to `4000` and `MAX_UPLOAD_MB` to `256`.
3. `TELEGRAM_API_ID` must be the number shown at my.telegram.org, and
   `TELEGRAM_API_HASH` the 32-character value from the same page.

### "Error: TRASH_RETENTION_DAYS must be zero or a positive integer"

**Cause.** `TRASH_RETENTION_DAYS` accepts `0` and any whole number of days.
A negative value or a non-integer is rejected.

**Fix.**

1. Set it to a whole number of days. `0` is valid and means "keep the trash
   indefinitely": the purge is skipped and nothing is removed automatically.
2. The default is `30`.

### "No API token configured. Create one in the web app (Settings → API tokens)"

**Cause.** An encryption command (`upload`, `download`, `migrate`,
`recovery`, `versions`) needs an API token, and none is stored in
`~/.config/omnicloud/config.json`. The full message is "No API token
configured. Create one in the web app (Settings → API tokens), then run:
omnicloud login (config: …)".

**Fix.**

1. Create a token in the web app under **Settings → API tokens**. The
   secret is shown once.
2. Run `omnicloud login` and paste it at the prompt. The token is read from
   a muted prompt, never from `argv`.
3. The token must be at least 32 characters. A shorter paste is rejected with
   "An API token is at least 32 characters; create one in the web app
   (Settings → API tokens)".

## Build, database and serving

### `prisma generate` errors

**Symptoms.** `@prisma/client did not initialize yet`, missing generated
types, or type errors referencing `PrismaClient`.

**Cause.** The generated client is out of date or absent (for example after
a clean checkout, a branch switch, or a schema change).

**Fix.**

1. Regenerate it:

   ```bash
   pnpm db:generate
   ```

2. `postinstall` runs this automatically, but run it explicitly after
   editing `packages/database/prisma/schema.prisma` or after dependency
   changes.
3. If it still fails, ensure `DATABASE_URL` is syntactically valid.
   `prisma generate` does not need a live database, but a malformed URL can
   still trip it.

### The app starts with "table does not exist" errors

**Cause.** The migrations were not applied, or the database schema drifted
from the migration history.

**Fix.**

1. Apply the migrations. From a source checkout, `pnpm db:migrate`. With the
   published package, `omnicloud start` runs `prisma migrate deploy` before
   the server listens, so starting the server applies them.
2. Confirm the applied migrations:

   ```sql
   SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY finished_at;
   ```

3. If the database was modified outside migrations, `migrate deploy` reports
   a divergence. Reconcile the schema, or in development only, reset it.
4. Always take a backup before applying migrations to a database with real
   data.

### The root URL returns JSON `404 NOT_FOUND`

**Cause.** `WEB_DIST_DIR` is unset, or points at a directory that does not
exist, so the API registers no static handler and every unknown route falls
through to the JSON not-found handler. The web app is not being served.

**Fix.**

1. Check what the server sees:

   ```bash
   curl -sS -o /dev/null -w "%{content_type}\n" https://cloud.example/
   ```

   `application/json` means the SPA is not being served.

2. With the published package, `omnicloud start` sets `WEB_DIST_DIR` to
   `<package>/server/web` for you. If you set it yourself, point it at a
   directory that contains `index.html`.
3. **Check for an empty `WEB_DIST_DIR=` line in your `.env`.** The CLI only
   sets the bundled path when the variable is unset
   (`env.WEB_DIST_DIR ??= …`), and an empty string counts as set. Leave the
   line out of the file entirely, or give it a real path.

### Deep links such as `/folders/abc` return JSON instead of the app

**Cause.** The SPA fallback only applies when the static handler is
registered, which needs a valid `WEB_DIST_DIR`. See
[the entry above](#the-root-url-returns-json-404-not_found).

**Fix.**

1. Fix `WEB_DIST_DIR` first.
2. With SPA serving enabled, unhandled `GET` requests outside `/api/` return
   `index.html`. Unknown `/api/` routes and non-`GET` requests still return
   JSON `404`.

### The server crashes at startup with an `ENOENT` error

**Cause.** `WEB_DIST_DIR` points at a directory that exists but has no
`index.html`. The static handler reads the file at startup, and a page it
cannot read fails startup rather than being served without a policy.

**Fix.**

1. Confirm the file is there:

   ```bash
   ls -l "$WEB_DIST_DIR/index.html"
   ```

2. Point `WEB_DIST_DIR` at a complete build, or unset it.
3. With the published package, use the bundled path the CLI sets:
   `<package>/server/web`.

## Encryption and recovery

Client-side end-to-end encryption (OCE1) is opt-in and experimental. It has
not been through an independent cryptographic review. Telegram and the server
still see file names, sizes and timing unless you also use the OCE2
"hide the name" migration, which is not enabled by default and is equally
unreviewed.

### "The key must be exactly 64 hexadecimal characters"

**Cause.** The root key was pasted into the web app's unlock field in the
wrong format.

**Fix.**

1. The root key is 32 bytes, shown as 64 hex characters.
2. The field trims surrounding whitespace and accepts upper and lower case,
   so a copied key is fine. What it rejects is a key of the wrong length.
3. If you no longer have the key, restore it from a recovery code
   (`omnicloud recovery restore`). Generating a new one does not help: it
   produces a different key, and files encrypted under the old key stay
   unreadable. The only way to read them again is to re-upload the plaintext
   from a source you still have.

### "Sealed value failed authentication"

**Cause.** The stored Telegram session could not be decrypted. The value in
the database was sealed with a different `OMNICLOUD_ENCRYPTION_KEY` than the
one currently configured — usually after restoring a database backup without
restoring the matching key, or after rotating the key without re-sealing.

**Fix.**

1. Restore the original `OMNICLOUD_ENCRYPTION_KEY`. The key is the only
   thing that opens those sessions.
2. If the original key is gone, the stored sessions cannot be recovered.
   Users sign in again with the QR or phone flow, and the new sessions are
   sealed with the current key. Files and folders are unaffected.
3. Do not rotate the key casually. Changing it without re-sealing makes every
   stored session unreadable in the same way.

### "Recovery failed: the code is incorrect or the stored record is damaged."

**Cause.** `omnicloud recovery restore` could not open the stored recovery
blob with the code you pasted. Either the code is wrong, or the stored blob
is damaged.

**Fix.**

1. Check the code. It is 64 hex characters, shown as eight groups of eight
   separated by dashes. The CLI accepts the formatted code or a plain paste;
   other characters are ignored.
2. Check that you are restoring against the account that generated the
   record. The blob is stored per user, and `recovery restore` reads the
   account named by the stored API token.
3. If the code is right and the blob is still damaged, the recovery record
   is unusable. Generate a new one from a key you still hold:

   ```bash
   omnicloud recovery generate --reveal
   ```

   Generating a new record replaces the old one, so the previous code stops
   working.

### "No recovery record is stored for this account. Create one with `omnicloud recovery generate --reveal`."

**Cause.** There is no recovery blob on the server for the account the
stored API token belongs to.

**Fix.**

1. Generate one:

   ```bash
   omnicloud recovery generate --reveal
   ```

2. The command needs a root key (from a keyfile or the muted prompt) and a
   stored API token.
3. Write the code down. It is shown once, and the server cannot reset it:
   the blob is ciphertext that only the code opens.

> **Warning:** a recovery record protects the root key. The server stores it
> as ciphertext it cannot open, so losing both the root key and the recovery
> code means losing the file contents.

### "key generate needs an explicit destination: --keyfile <path> … or --reveal"

**Cause.** `omnicloud key generate` refuses to guess where the key should
go. A key written to a file and a key printed once on screen are different
choices, and neither happens by accident.

**Fix.**

1. Write it to a file, at mode `0600`:

   ```bash
   omnicloud key generate --keyfile ~/.config/omnicloud/root.key
   ```

2. Or print it once on this terminal:

   ```bash
   omnicloud key generate --reveal
   ```

3. `--reveal` needs an interactive terminal. On a script or a CI runner it
   fails with "The root key can only be shown on an interactive terminal".
   Use `--keyfile` there.

### "The root key is displayed only with an explicit --reveal flag"

**Cause.** A secret was about to be printed without `--reveal`. This is
deliberate: secrets are never shown implicitly.

**Fix.**

1. Add `--reveal`, on an interactive terminal.
2. Or use `--keyfile <path>` and read the file yourself. The keyfile is
   written at mode `0600` and the command warns if it finds it readable by
   anyone else.

### "A root key must be 64 hexadecimal characters (32 bytes)"

**Cause.** The key you pasted at the muted prompt is not 64 hex characters.
The CLI trims whitespace and lower-cases the input before checking it, so
upper case and stray spaces are fine.

**Fix.**

1. Check for a missing or extra character. The key is exactly 64 hex
   characters.
2. If the key is lost, restore it from a recovery code
   (`omnicloud recovery restore`) or from a keyfile.
3. A new key cannot open files that were encrypted under the old one.

### "File <id> is not encrypted (stored as plaintext); --decrypt only opens OCE1-encrypted files. Migrate it first: omnicloud migrate <id>"

**Cause.** `omnicloud download --decrypt` only opens OCE1-encrypted files, and
this file is a legacy plaintext file. There is no silent fallback: the
command fails instead of handing back ciphertext that looks like plaintext.

**Fix.**

1. Migrate the file, then decrypt it:

   ```bash
   omnicloud migrate <id>
   omnicloud download <id> --decrypt -o ./file.bin
   ```

2. To migrate every legacy plaintext file at once:

   ```bash
   omnicloud migrate all
   ```

   The command reports `migrated`, `migrated_with_plaintext_history`,
   `already_migrated` or `failed` per file, and exits `1` if any file
   failed.

> **Note:** `omnicloud migrate` is overloaded. With a file id (or `all`) it
> encrypts legacy plaintext files. Bare, it applies the database migrations.
> The argument decides which one runs.

### "omnicloud upload always encrypts client-side — pass --encrypt. There is no plaintext upload path."

**Cause.** The CLI has no plaintext upload. Encryption is not optional here.

**Fix.**

1. Run `omnicloud upload <path> --encrypt`.
2. You need a root key (a keyfile or the muted prompt) and a stored API
   token.
3. Files at or above 8 MiB take the streaming path: the bytes are encrypted
   chunk by chunk into a `0600` spool file and sent as a disk-backed
   multipart body, so peak memory stays bounded by the chunk size.

### "<name> is encrypted. Generate or unlock your encryption key in Settings, then try again."

**Cause.** The browser tab has no root key loaded. The key lives in memory
only for the tab's session — never in `localStorage`, IndexedDB or a
cookie — so a reload requires unlocking it again.

**Fix.**

1. Open **Settings → Encryption** and unlock the key, or generate one if
   this is a new browser.
2. If the key is lost and no recovery code exists, the encrypted files
   cannot be opened. Regenerating the key does not help; it produces a
   different key.
3. For a file you do not have the key for, the server still holds the
   ciphertext. A new upload with the new key works; the old file stays
   unreadable.

## The update check

### No update notice appears in the sidebar

**Cause.** The notice is rendered only when the server's cached npm check
reports `update_available`. If the check has not run, has failed, or the
package is not published, nothing is shown — that is deliberate, so the
badge stays meaningful.

**Fix.**

1. Ask the server what it knows:

   ```bash
   curl -sS https://cloud.example/api/update/check | jq .
   ```

2. Interpret the `status`:

   | `status`           | Meaning                                                          |
   | ------------------ | ---------------------------------------------------------------- |
   | `update_available` | A newer version is published; the sidebar shows a notice         |
   | `up_to_date`       | The published version is the same or older                       |
   | `not_published`    | The package does not exist on npm yet                            |
   | `unknown`          | The registry could not be reached; the last error is in `detail` |

3. `unknown` with "The update check has not completed yet." means the first
   check is still in flight. Wait a few seconds and ask again.
4. `unknown` with a registry error means the server cannot reach
   `registry.npmjs.org`. Check outbound HTTPS from the server, or set
   `UPDATE_CHECK_ENABLED=false` to stop the check entirely.

### The update notice appears but nothing changes after installing

**Cause.** The notice comes from the server's hourly cached check, not from
the running version. The server reports the version of the package that is
installed, so the notice clears on the next restart with the new version.

**Fix.**

1. Confirm the running version:

   ```bash
   curl -sS https://cloud.example/api/health | jq .version
   ```

2. Confirm the installed version:

   ```bash
   npx omnicloud version
   ```

3. Restart the service after installing. The registry is contacted at most
   once an hour, so the cached result can lag by up to an hour.

### The server makes an outbound request to registry.npmjs.org every hour

**Cause.** The update check runs on a fixed one-hour interval and is enabled
by default. It is the only outbound HTTP request the server makes; the rest
of the outbound traffic is the Telegram connection.

**Fix.**

1. Set `UPDATE_CHECK_ENABLED=false` and restart the server to disable it
   completely.
2. The check is cached server-side, so many open browsers do not multiply
   the traffic — the registry is contacted once per interval regardless.

## Health and diagnostics cheat sheet

| Endpoint                            | Auth    | What it tells you                                                                    |
| ----------------------------------- | ------- | ------------------------------------------------------------------------------------ |
| `GET /api/health/live`              | none    | Process liveness. Checks no dependency, so it always answers while the process runs. |
| `GET /api/health/ready`             | none    | Database reachable and encryption configured. `503` when not ready.                  |
| `GET /api/health`                   | none    | Process up, database reachable, version, uptime. Always `200`; read the body.        |
| `GET /api/health/database`          | none    | Database only                                                                        |
| `GET /api/auth/me`                  | none    | Whether the caller has a session; light storage state (no Telegram round-trip)       |
| `GET /api/storage/health`           | session | Cached storage health plus statistics                                                |
| `POST /api/storage/health/check`    | session | Fresh probe; `{ "deep": true }` does a real Telegram round-trip                      |
| `POST /api/storage/integrity/check` | session | Read-only drift report (use `{ "deep": true }` to re-hash bytes)                     |
| `POST /api/storage/reconciliation`  | session | Read-only comparison of the channel with the database                                |
| `POST /api/storage/ensure`          | session | Creates the storage channel if missing                                               |
| `GET /api/trash/retention`          | session | The configured trash retention period in days                                        |

Operator guidance for a production install — sizing, the reverse proxy,
migrations, updates and backups — is in
[deployment.md](deployment.md).
