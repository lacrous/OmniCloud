# Changelog

All notable changes to OmniCloud are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
