# Changelog

All notable changes to OmniCloud are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Reliability

- **Retries decide from the error type, not its message.** Errors declare whether
  they are retryable (`DomainError.retryable`). Message matching is removed.
- **Flood waits are honoured exactly.** `RateLimitedError` carries the
  server-requested `retryAfterSeconds`, and the engine waits that long.
- **Uploads are idempotent.** An `Idempotency-Key` header (or `operationId` field)
  makes a retried upload return the original file. A retry never creates a second
  Telegram object. An operation whose object was stored but whose metadata failed
  is recovered without uploading again. Keys are per user and must be 8–64 URL-safe
  characters.
- Migration `4_upload_operations` is additive.

### Fixed

- **Restore cannot attach a folder under another user's folder.** A foreign
  parent id in a trashed folder's row is now dropped on restore, and the folder
  falls back to the root.
- **The served web app now sends a Content-Security-Policy.** The policy allows
  inline scripts and styles only by hash, so an injected inline script is blocked.
  Previously the page had no policy, although a code comment said it did.

- **Concurrent uploads with the same idempotency key store one object.** Requests
  that raced to create the operation used to fail with a duplicate-key error,
  because the create had no typed handling. A losing request now follows the
  winner's result. Only the request that wins an atomic claim from `PENDING` (or
  `FAILED`) uploads. Found by a concurrency test; the claim is verified with a
  pause placed before it, which fails when the claim is removed.
- **A recursion bug in the new follow-the-winner path** could run out of memory
  under contention. Replaced with a bounded loop; a request that cannot finish
  within the budget gets a conflict, not an unbounded wait.

- **Concurrent folder moves cannot create a cycle.** Two moves that each passed the
  ancestor check could both commit, making A and B each other's parent. Moves now
  re-check the ancestor chain and write in one serializable transaction, so one
  of two conflicting moves is rejected. Reproduced on PostgreSQL before the fix
  (5 of 5 runs created a cycle) and verified after (0 of 5). A PostgreSQL
  regression test runs when `OMNICLOUD_TEST_DATABASE_URL` is set.

- The SDK rejects a download whose body ends before `Content-Length` with
  `DOWNLOAD_INCOMPLETE`, instead of returning a truncated buffer.

### Added

- `docs/limitations.md` is now the single list of what this release does not
  guarantee. Earlier pages that said uploads were buffered in memory, or that
  sessions were signed JWTs, were corrected to match the code.
- `docs/release-checklist.md` names the command or test behind each release item.

- Health probes: `GET /api/health/live` (process liveness, checks no dependency)
  and `GET /api/health/ready` (database and encryption configuration; `503` when
  not ready). Storage is not part of readiness.
- One structured record per upload, permanent delete, and streamed download
  (duration, size, status, error code). Records contain no file contents.
- Log redaction masks session strings, cookies, tokens, passwords, login codes
  and the configured secrets before any line is written.

- `POST /api/storage/reconciliation` — a **read-only** report of channel objects no
  record references (`unknown`) and records whose object is gone (`dangling`).
  It never deletes anything. Unknown objects are reported for a person to decide.

- **A failed commit no longer leaves an unreferenced Telegram object.** If the file
  or version record cannot be written after Telegram accepted the upload, the
  stored object is removed and the original error is returned. This covers a new
  upload, and a replace whose file was deleted mid-upload. Regression tests fail
  without the cleanup.
- Batch file operations accept an optional `operationId`, echoed in the result, so
  a batch can be correlated with its outcome.

- **Permanent delete no longer orphans old versions.** Historical version objects
  were removed best-effort, and their metadata was then deleted even when the
  Telegram delete failed. Any remote failure now fails the operation and keeps
  every version pointer, so a retry completes the cleanup.

### Changed

- **Integrity checks cover historical versions.** `POST /api/storage/integrity/check`
  inspects each version object as well as the current one. Issues on a version
  carry a `versionId`.
- **Deep integrity streams.** The deep check hashes each object while streaming
  it, instead of downloading it into memory.
- A version retention model (`KEEP_ALL`, `KEEP_LATEST_N`, `KEEP_FOR_DAYS`) is
  defined and tested. It is not yet enforced: the default keeps every version, and
  the current version is never a candidate for pruning.

- **File downloads stream from Telegram.** `GET /api/files/:id/download` pipes
  Telegram chunks straight to the client instead of buffering the whole file.
  Verified with unit tests against a fake GramJS client; not yet measured against
  a live account.
- **Uploads are spooled to disk.** `POST /api/files` and `POST /api/files/:id/replace`
  write the multipart body to a temporary file while hashing it, then hand that
  file to GramJS by path. The temporary file is removed on success and failure.
  The engine no longer concatenates the whole upload in memory. Measured with
  `pnpm --filter @omnicloud/api measure:upload-memory`: an 8x larger upload adds
  about the same live memory (0.4 MB vs 0.5 MB).
- **Integrity is verified before the final bytes are released.** A corrupt object
  ends the response with a broken connection rather than a complete-looking body.
- **`X-Integrity-Verified` header removed from the download endpoint.** It cannot
  be known before a streamed body is sent. Clients should treat an incomplete
  transfer as a failed download.

### Security

- **Browser sessions are server-side and revocable.** The cookie is an opaque
  random token; only its SHA-256 is stored (`BrowserSession`). Logout revokes the
  session immediately, so a copied cookie stops working. `POST /api/auth/logout-all`
  signs out every session for the account. Expired sessions are pruned hourly.
  Migration `3_browser_sessions` is additive; existing users must sign in again
  once, because old JWT cookies are no longer accepted.
- **Telegram sessions are encrypted at rest** (AES-256-GCM), keyed by the new
  `OMNICLOUD_ENCRYPTION_KEY`, which is required in production. Existing plaintext
  sessions are re-sealed on first use.
- `SESSION_SECRET` no longer signs anything and is no longer required in production.

## [0.2.1] — 2026-10-08

### Fixed

- **SDK type declarations were incomplete.** The published `@lacrous/omnicloud@0.2.0`
  `index.d.ts` imported internal modules (`./query`, `./mime`, `./client`, `./errors`)
  that are not shipped in the package, so TypeScript consumers got missing or `any`
  types. The bundled declarations are now self-contained, and the build no longer
  prints "Ambiguous external namespace resolution" warnings.
- Recent view orders activity by `(createdAt, id)`, so events recorded in the same
  millisecond resolve deterministically.

## [0.2.0] — 2026-10-07

**Reliability & Storage Experience.** This release makes the v0.1 proof-of-concept
trustworthy for everyday use: a real file lifecycle, a resilient storage engine, a
dependable Telegram connection, integrity checking, and a full Drive UI.

### Added

- **Trash and restore.** Deletion is now a soft delete; a folder's whole subtree is
  trashed and restored as one set (tracked by a batch marker, not timestamps), and
  restore falls back to the root when the original parent is gone. Permanent deletion
  removes the remote Telegram objects first and keeps the metadata if that fails, so
  interrupted deletions can be retried instead of silently losing data.
- **File versioning foundation.** Every upload creates a `FileVersion` row; a new
  `POST /api/files/:id/replace` endpoint appends a version and repoints the file at
  it. The data model and API are in place; a version-history UI is planned for v0.3.
- **Starred and Recent.** Files and folders can be starred, with a `/api/starred`
  view, and `/api/recent` lists the files you actually touched, newest first,
  deduplicated and excluding trashed items.
- **Activity log.** Structured, ownable events for uploads, downloads, opens, renames,
  moves, stars, trashes, restores, deletions and folder creation, with
  credential-shaped metadata keys stripped before storage.
- **Search 2.0.** A small PostgreSQL-backed query language:
  `type:pdf`, `type:image`, `ext:zip`, `size:>100MB`, `size:<1KB`, `folder:Projects`,
  `starred:true`, `trashed:true`, `after:2026-01-01`, `before:2026-06-01`.
- **Storage dashboard.** `/api/storage/stats` returns file and folder counts, total
  and trash size, starred count, a per-category byte breakdown and the largest files.
- **Integrity checking.** `/api/storage/integrity/check` (optionally deep) reports
  missing objects, size mismatches, hash mismatches and unreadable objects. It is
  strictly read-only — repairs are never applied automatically.
- **Telegram connection manager.** Explicit connection states (`DISCONNECTED`,
  `CONNECTING`, `CONNECTED`, `RECONNECTING`, `ERROR`, `AUTH_REQUIRED`), cached health
  probes, cooldown-guarded reconnection, and a per-user storage `healthCheck` that
  validates the channel with a real round-trip.
- **Storage engine 2.0.** Streaming-friendly provider interface
  (`getStream`, streamed uploads), bounded retries with exponential backoff (only
  transient failures retry), transfer progress reporting, and cancellation via
  `AbortSignal`.
- **API 2.0.** Pagination (`page`/`limit` with a `{page,limit,total,hasMore}`
  envelope), sorting (`sort`/`order`), filtering (`type`, `ext`, `starred`, `status`,
  size and date bounds), batch operations for files and folders
  (`POST /api/files/batch`, `POST /api/folders/batch`), trash endpoints, and public
  health probes (`/api/health`, `/api/health/database`).
- **Request tracing and hardening.** Every request gets an id (inbound `X-Request-Id`
  honored and echoed, included in error bodies), baseline security headers are set,
  and state-changing requests are checked against an origin allowlist.
- **Structured error codes.** A stable vocabulary (`AUTH_REQUIRED`, `FILE_NOT_FOUND`,
  `STORAGE_UNAVAILABLE`, `TELEGRAM_AUTH_REQUIRED`, `UPLOAD_FAILED`,
  `INTEGRITY_CHECK_FAILED`, …) with consistent HTTP statuses.
- **Drive UI 2.0.** Sidebar navigation (My Drive, Recent, Starred, Trash, Storage),
  grid and list views with a persisted preference, sorting, multi-select with a batch
  action bar, right-click and per-item context menus, a details panel with version
  history, drag-and-drop uploads with progress, cancel and retry, keyboard shortcuts,
  and a Storage dashboard with the integrity scan.
- **SDK 0.2.** `OmniCloudClient` now exposes namespaced APIs
  (`cloud.files`, `cloud.folders`, `cloud.trash`, `cloud.storage`, `cloud.search`,
  `cloud.recent`, `cloud.activity`, `cloud.auth`), with configurable retry,
  upload/download progress, download integrity metadata, and structured
  `OmniCloudError` (status, code, requestId).
- **Developer experience.** `pnpm db:seed` seeds a local user with folders and files,
  `CONTRIBUTING.md` and `SECURITY.md` were added, and CI now also verifies that
  migrations apply cleanly to a fresh database and that the built SDK bundle imports
  in both ESM and CommonJS.

### Changed

- List endpoints default to active items only; trashed content appears solely in the
  Trash view (and via explicit `status=trashed|all`).
- `GET /api/auth/me` now also returns storage health, so the UI can show connection
  state without an extra request.
- Folder `DELETE` routes now perform the guarded permanent delete (remote objects
  first) instead of the v0.1 best-effort sweep.
- The web app was rebuilt on the shared design system with light/dark themes.

### Database

- Additive, backward-safe migrations: `starred`, `deletedAt`, `currentVersionId`,
  `versionCount` and `trashBatchId` columns; new `FileVersion` and `ActivityEvent`
  tables; and supporting indexes. Pre-v0.2 files are backfilled with version 1 so
  their history is complete.

### Fixed

- Files whose latest activity was a star or unstar no longer disappear from Recent.
- A folder move can no longer be directed into the folder's own descendant.

### Known limitations

- Files are buffered in memory during transfer; the default cap is `MAX_UPLOAD_MB`
  (256 MB). Telegram caps a single document at 2 GB.
- No end-to-end encryption — Telegram can technically read channel content.
- Version history is stored but has no dedicated restore UI yet.
- Single-process server; rate limiting is in-memory and applies to auth endpoints.
- Search is metadata-only (no content search).

## [0.1.1] — 2026-10-06

### Fixed

- The published ESM bundle used directory-style GramJS subpath imports
  (`telegram/sessions`, `telegram/client/uploads`), which Node's ESM loader
  cannot resolve — replaced with explicit file paths so
  `import { OmniCloudClient } from "@lacrous/omnicloud"` works in Node.
- Removed a duplicate `dts` key in the SDK build config.

## [0.1.0] — 2026-10-06

First public MVP. OmniCloud is a self-hosted cloud storage platform that uses
your own Telegram account as the underlying storage backend.

### Added

- Telegram account connection (phone → code → optional 2FA password) with
  server-side MTProto session management
- Automatic creation of a private Telegram storage channel per user
- File upload, download, rename, move, delete
- Folder creation, renaming, moving and recursive deletion
- Metadata-based search over file and folder names
- SHA-256 integrity verification of every uploaded file
- Drive-like web interface: navigation, search, drag-and-drop upload with
  progress, rename/move/delete dialogs
- StorageProvider abstraction with the first Telegram implementation
- PostgreSQL metadata layer via Prisma
- `@lacrous/omnicloud` SDK package (HTTP client + storage building blocks)
- Docker Compose development environment (PostgreSQL)
- GitHub Actions CI and release automation

### Known limitations

- Files are buffered in memory during upload/download; the default upload
  limit is 256 MB (configurable via `MAX_UPLOAD_MB`).
- End-to-end encryption is not implemented — Telegram can technically read
  channel content. See `docs/security.md`.
- No trash/recycle bin: deletion is permanent.
- No file sharing, public links, or multi-user collaboration.
- The web app and API must run as a single Node.js process (no clustering).
- Search is limited to name substring matching in PostgreSQL.
