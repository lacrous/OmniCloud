# Changelog

All notable changes to OmniCloud are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
