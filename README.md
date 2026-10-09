# OmniCloud

**Self-hosted cloud storage powered by your own Telegram account.**

OmniCloud is an open-source, Google-Drive-inspired cloud storage platform. Instead of S3 or another object-storage provider, OmniCloud uses your **Telegram account** as the physical storage backend: you connect your account, OmniCloud creates a private Telegram channel for you, and every file you upload is stored there — while OmniCloud manages folders, metadata, search, trash and file operations through its own application layer.

```text
User
 │
 ▼
OmniCloud Web (React)
 │
 ▼
OmniCloud API (Fastify)
 │
 ├── PostgreSQL ── metadata (users, folders, files, versions, trash, activity)
 │
 └── Storage Engine ── StorageProvider abstraction
        │
        ▼
  Telegram Provider (MTProto / GramJS)
        │
        ▼
  Private Telegram Channel (the actual bytes)
```

> **Telegram = physical storage · PostgreSQL = logical filesystem · OmniCloud = the cloud layer**

## What's new in v0.2 — _Reliability & Storage Experience_

v0.2 is about making the existing system trustworthy rather than bolting on features:

- 🗑️ **Trash & restore** — deleting is now a soft delete; restore is lossless because nothing remote is touched until you permanently delete
- 🔁 **Version foundation** — every upload creates a version row; "replace" appends a new version and repoints the file at it
- ⭐ **Starred and Recent** — star any file or folder; the Recent view shows what you actually touched, newest first
- 🎛️ **Reliability in the storage engine** — bounded retries with backoff, upload/download progress, cancellation, streaming downloads
- 🔌 **Telegram connection manager** — explicit connection states, health checks and cooldown-guarded reconnection instead of a fragile client cache
- 🩺 **Storage dashboard** — usage, per-type breakdown, largest files, and a read-only integrity scan that reports drift between PostgreSQL and Telegram
- 🔍 **Search 2.0** — a small query language: `type:pdf`, `size:>100MB`, `folder:Projects`, `starred:true`, `after:2026-01-01`
- 🖥️ **Drive UI 2.0** — sidebar navigation, grid/list views, sorting, multi-select with batch actions, context menus, a details panel with version history, keyboard shortcuts, and uploads you can cancel and retry
- 🛡️ **Hardening** — request IDs through logs and error bodies, security headers, origin allowlists, structured error codes
- 📊 **Activity log** — structured, credential-free events for everything meaningful you do

## Features

- 🔐 **Telegram account connection** — phone + confirmation code (+ 2FA support); the MTProto session is stored server-side only
- 📡 **Automatic private storage channel** — created on first login, no manual Telegram setup
- 📤 **File upload & download** — drag-and-drop, upload progress, cancellation and retry
- 📁 **Folders** — create, rename, move, star; trash and restore a whole subtree
- 📝 **File management** — rename, move, star, replace (new version), trash, restore, permanent delete
- 🗑️ **Trash** — review, restore individually, or empty it
- 🔎 **Search** — filename plus type/size/folder/date/star filters, sortable and paginated
- ✅ **SHA-256 integrity** — every file's checksum is stored and verified on download
- 🩺 **Integrity checking** — detect missing objects, size mismatches and (deep mode) hash mismatches; read-only, never repairs silently
- 🖥️ **Drive-like web interface** — gold-on-warm-paper theme with light/dark modes
- 📦 **`@lacrous/omnicloud` SDK** — a namespaced client with pagination, retry and progress support

## Architecture

OmniCloud separates the cloud application from the storage provider. The application **never** depends on Telegram-specific details — everything goes through a small `StorageProvider` interface:

```ts
interface StorageProvider {
  readonly name: string;
  put(input: StorageUploadInput, control?: TransferControl): Promise<StoredObject>;
  get(ref: StoredRef, control?: TransferControl): Promise<Buffer>;
  getStream(ref: StoredRef, control?: TransferControl): Promise<Readable>;
  delete(ref: StoredRef): Promise<void>;
  exists(ref: StoredRef): Promise<boolean>;
  stat(ref: StoredRef): Promise<StoredObject | null>;
  healthCheck(): Promise<StorageHealth>;
}
```

`TelegramStorageProvider` is the first implementation. `StorageEngine` wraps it with the cross-cutting guarantees (checksums, retries, progress, cancellation). See [`docs/architecture.md`](docs/architecture.md) and [`docs/storage-provider.md`](docs/storage-provider.md).

### Repository layout

```text
apps/
├── web/            React + Vite + Tailwind web application
└── api/            Fastify HTTP server
packages/
├── core/           Domain logic, storage abstraction, services
├── telegram/       TelegramStorageProvider + MTProto connection management
├── database/       Prisma schema, migrations, repository implementations
├── shared/         DTOs, error codes, search query parser, MIME helpers
└── sdk/            @lacrous/omnicloud — published developer SDK
```

## Requirements

- Node.js 20+ (22 recommended)
- pnpm 10+
- PostgreSQL 14+ (or Docker)
- A **Telegram API ID & hash** — create a free application at [my.telegram.org](https://my.telegram.org) → _API development tools_

## Installation

```bash
git clone https://github.com/Lacrous/OmniCloud.git
cd OmniCloud
pnpm install

# configure
cp .env.example .env
# → edit .env: set TELEGRAM_API_ID, TELEGRAM_API_HASH and OMNICLOUD_ENCRYPTION_KEY
#   (generate the key with: openssl rand -hex 32)
```

Start PostgreSQL (or point `DATABASE_URL` at your own instance):

```bash
docker compose up -d
```

Create the database schema:

```bash
pnpm db:migrate
```

## Running locally

```bash
# API on http://localhost:4000, web on http://localhost:5173 (proxies /api)
pnpm dev
```

Open <http://localhost:5173>, connect your Telegram account, and OmniCloud creates your private storage channel automatically.

Optional: seed a local user with folders and files (no Telegram needed) to click around the UI:

```bash
pnpm db:seed
```

Production-style single-port serving (the API also serves the built web app):

```bash
pnpm build
WEB_DIST_DIR=apps/web/dist pnpm --filter @omnicloud/api start
```

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable                   | Required  | Description                                                                                                                                   |
| -------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`             | ✅        | PostgreSQL connection string                                                                                                                  |
| `TELEGRAM_API_ID`          | ✅        | Telegram application API ID ([my.telegram.org](https://my.telegram.org))                                                                      |
| `TELEGRAM_API_HASH`        | ✅        | Telegram application API hash                                                                                                                 |
| `OMNICLOUD_ENCRYPTION_KEY` | ✅ (prod) | Seals Telegram sessions at rest (AES-256-GCM). Keep it backed up apart from the database; losing it makes stored Telegram sessions unreadable |
| `SESSION_SECRET`           | –         | Reserved. Browser sessions are server-side tokens and no longer use this value                                                                |
| `HOST` / `PORT`            | –         | Listen address and port (default `0.0.0.0:4000`)                                                                                              |
| `NODE_ENV`                 | –         | `development` (default) or `production`                                                                                                       |
| `LOG_LEVEL`                | –         | Fastify log level (default `info`)                                                                                                            |
| `COOKIE_SECURE`            | –         | Set `true` when serving over HTTPS                                                                                                            |
| `ALLOWED_ORIGINS`          | –         | Comma-separated origins allowed for state-changing requests                                                                                   |
| `TRUST_PROXY`              | –         | Trust `X-Forwarded-*` from a reverse proxy                                                                                                    |
| `MAX_UPLOAD_MB`            | –         | Upload size limit (default `256`)                                                                                                             |
| `WEB_DIST_DIR`             | –         | Path to the built web app for single-port serving                                                                                             |
| `STORAGE_QUOTA_GB`         | –         | Optional quota shown on the Storage dashboard (default: none)                                                                                 |

## Telegram setup

1. Visit [my.telegram.org](https://my.telegram.org), log in, open **API development tools** and create an application.
2. Copy the **api_id** and **api_hash** into `TELEGRAM_API_ID` / `TELEGRAM_API_HASH`.
3. On first login, OmniCloud authenticates via MTProto as _your user account_ and creates a private channel named **OmniCloud Storage**. Uploaded files are sent as force-downloaded documents, so each file is one message in that channel; permanently deleting a file in OmniCloud deletes the corresponding Telegram message.

Your Telegram credentials and session never leave the server: the MTProto session string is stored in your PostgreSQL database and never logged, and the browser only receives OmniCloud's own session cookie. See [`docs/telegram.md`](docs/telegram.md).

## API

The full reference is [`docs/api.md`](docs/api.md). Summary:

```text
Health      GET  /api/health · /api/health/database
Auth        POST /api/auth/telegram/start · verify · password ; GET /api/auth/me ; POST /api/auth/logout
Storage     POST /api/storage/ensure ; GET /api/storage/health · stats
            POST /api/storage/health/check · integrity/check
Files       GET  /api/files (filter/sort/paginate) ; POST /api/files
            GET  /api/files/:id · versions · download
            POST /api/files/:id/replace · move · trash · restore · batch
            PATCH /api/files/:id ; DELETE /api/files/:id (permanent)
Folders     GET  /api/folders · tree ; POST /api/folders ; PATCH /api/folders/:id
            POST /api/folders/:id/move · trash · restore · batch
            DELETE /api/folders/:id (permanent)
Trash       GET  /api/trash ; POST /api/trash/empty
Collections GET  /api/starred · /api/recent · /api/search · /api/activity
```

Every response that lists items carries a pagination envelope (`page`, `limit`, `total`, `hasMore`). Errors use a stable envelope with a correlation id:

```json
{ "error": { "code": "FILE_NOT_FOUND", "message": "File not found", "requestId": "…" } }
```

## SDK

```bash
npm install @lacrous/omnicloud
```

```ts
import { OmniCloudClient } from "@lacrous/omnicloud";

const cloud = new OmniCloudClient({ baseUrl: "https://my-omnicloud.example" });

// Telegram login
await cloud.auth.startTelegramLogin("+15551234567");
const result = await cloud.auth.verifyTelegramCode("+15551234567", "12345");
if (result.status === "password_required") {
  await cloud.auth.submitTelegramPassword("+15551234567", "••••••••");
}

// Upload with progress, then organize
const file = await cloud.files.upload(
  { data: new Blob(["hello"]), name: "hello.txt" },
  { onProgress: (p) => console.log(`${p.percent}%`) },
);
await cloud.folders.create("Documents");
await cloud.files.star(file.id);
await cloud.files.trash(file.id);

// Search, reports and integrity
const found = await cloud.search.query("type:txt size:<1KB");
const stats = await cloud.storage.stats();
const report = await cloud.storage.integrityCheck({ deep: false });
```

The package also exports the server-side building blocks (`StorageProvider`, `StorageEngine`, `TelegramStorageProvider`, `FileService`, `FolderService`, `SearchService`, `TrashService`, `StatsService`, `IntegrityService`, …) for building custom deployments. See [`docs/sdk.md`](docs/sdk.md).

## Storage architecture

- **Telegram stores the bytes.** Files are sent as force-downloaded documents into the user's private channel; the message id is the object reference.
- **PostgreSQL stores the cloud.** Folders are purely virtual OmniCloud objects; files are metadata rows pointing at Telegram messages, with versions, trash state and stars alongside.
- **Integrity.** The SHA-256 of every upload is computed server-side, stored, and verified on download; the integrity checker can scan for drift in either direction.
- See [`docs/architecture.md`](docs/architecture.md) and [`docs/storage.md`](docs/storage.md).

## Security

See [`SECURITY.md`](SECURITY.md) and [`docs/security.md`](docs/security.md) for the threat model and operator guidance. Highlights: sessions are server-side only, all inputs are validated, every operation verifies ownership, filenames are sanitized, client MIME types are never trusted, auth endpoints are rate-limited, and every request is traced by id.

**Important:** end-to-end encryption is **not** implemented — Telegram can technically access channel content. OmniCloud is not a zero-knowledge vault.

## Limitations

See [docs/limitations.md](docs/limitations.md) for what this release does and
does not guarantee.

## Roadmap

- **v0.3** — version history UI and restore, sharing and public links, trash auto-purge retention, live verification of the Telegram path
- **v0.4** — alternative storage providers (S3, WebDAV, local disk), previews
- **v1.0** — end-to-end encryption, desktop/mobile sync clients, collaboration

## Contributing

PRs are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md). Please run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` before submitting (that is what CI runs). For larger changes, open an issue first.

## License

[MIT](LICENSE) — © 2026 Lacrous
