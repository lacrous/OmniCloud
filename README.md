# OmniCloud

**Self-hosted cloud storage powered by your own Telegram account.**

OmniCloud is an open-source, Google-Drive-inspired cloud storage platform. Instead of S3 or another object-storage provider, OmniCloud uses your **Telegram account** as the physical storage backend: you connect your account, OmniCloud creates a private Telegram channel for you, and every file you upload is stored there — while OmniCloud manages folders, metadata, search and file operations through its own application layer.

```text
User
 │
 ▼
OmniCloud Web (React)
 │
 ▼
OmniCloud API (Fastify)
 │
 ├── PostgreSQL ── metadata (folders, files, users)
 │
 └── Storage Engine ── StorageProvider interface
        │
        ▼
  Telegram Provider (MTProto / GramJS)
        │
        ▼
  Private Telegram Channel (the actual bytes)
```

> **Telegram = Physical Storage · PostgreSQL = Cloud Metadata · OmniCloud = Cloud Storage Layer**

## Features

- 🔐 **Telegram account connection** — phone + confirmation code (+ 2FA support), session stored server-side only
- 📡 **Automatic private storage channel** — created on first login, no manual Telegram setup
- 📤 **File upload & download** — including drag-and-drop and upload progress
- 📁 **Folders** — create, rename, move, recursive delete
- 📝 **File management** — rename, move, delete
- 🔎 **Search** — metadata search over file and folder names
- ✅ **SHA-256 integrity verification** — every file's checksum is stored and verified on download
- 🖥️ **Drive-like web interface**
- 📦 **`@lacrous/omnicloud` SDK** — build your own tooling on top

## Architecture

OmniCloud separates the cloud application from the underlying storage provider. The application **never** depends on Telegram-specific details — everything goes through a small `StorageProvider` interface:

```ts
interface StorageProvider {
  readonly name: string;
  put(input: { name: string; mimeType: string; data: Buffer }): Promise<StoredObject>;
  get(ref: StoredRef): Promise<Buffer>;
  delete(ref: StoredRef): Promise<void>;
  exists(ref: StoredRef): Promise<boolean>;
  stat(ref: StoredRef): Promise<StoredObject | null>;
}
```

`TelegramStorageProvider` is the first implementation (future candidates: S3, WebDAV, local disk). See `docs/storage.md` for details.

### Repository layout

```text
apps/
├── web/            React + Vite + Tailwind web application
└── api/            Fastify HTTP server
packages/
├── core/           Domain logic, storage abstraction, services
├── telegram/       TelegramStorageProvider + login flow (GramJS / MTProto)
├── database/       Prisma schema + repository implementations
├── shared/         DTOs and constants shared across packages
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
# → edit .env and fill in TELEGRAM_API_ID / TELELEGRAM_API_HASH and SESSION_SECRET
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

Open <http://localhost:5173>, connect your Telegram account, and OmniCloud
creates your private storage channel automatically.

Production-style single-port serving (API also serves the built web app):

```bash
pnpm build
WEB_DIST_DIR=apps/web/dist pnpm --filter @omnicloud/api start
```

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable            | Required  | Description                                                              |
| ------------------- | --------- | ------------------------------------------------------------------------ |
| `DATABASE_URL`      | ✅        | PostgreSQL connection string                                             |
| `TELEGRAM_API_ID`   | ✅        | Telegram application API ID ([my.telegram.org](https://my.telegram.org)) |
| `TELEGRAM_API_HASH` | ✅        | Telegram application API hash                                            |
| `SESSION_SECRET`    | ✅ (prod) | Secret used to sign browser session tokens                               |
| `PORT`              | –         | API port (default `4000`)                                                |
| `COOKIE_SECURE`     | –         | Set `true` when serving over HTTPS                                       |
| `MAX_UPLOAD_MB`     | –         | Upload size limit (default `256`)                                        |
| `WEB_DIST_DIR`      | –         | Path to the built web app for single-port serving                        |
| `LOG_LEVEL`         | –         | Fastify log level (default `info`)                                       |

## Telegram setup

1. Visit [my.telegram.org](https://my.telegram.org), log in, open **API development tools** and create an application.
2. Copy the **api_id** and **api_hash** into `TELEGRAM_API_ID` / `TELEGRAM_API_HASH`.
3. On first login, OmniCloud authenticates via MTProto as _your user account_ and creates a private channel named **OmniCloud Storage**. All uploaded files are document messages in that channel; deleting a file in OmniCloud deletes the corresponding Telegram message.

Your Telegram credentials and session never leave the server: the MTProto session string is stored in your PostgreSQL database, and the browser only receives OmniCloud's own session cookie.

## API

The HTTP API is documented in [`docs/api.md`](docs/api.md). Summary:

```text
Auth        POST /api/auth/telegram/start · verify · password
            GET  /api/auth/me
            POST /api/auth/logout
Storage     POST /api/storage/ensure
Files       POST /api/files · GET /api/files · GET /api/files/:id
            GET  /api/files/:id/download · PATCH /api/files/:id
            POST /api/files/:id/move · DELETE /api/files/:id
Folders     POST /api/folders · GET /api/folders · GET /api/folders/tree
            PATCH /api/folders/:id · POST /api/folders/:id/move · DELETE /api/folders/:id
Search      GET  /api/search?q=…
```

## SDK

```bash
npm install @lacrous/omnicloud
```

```ts
import { OmniCloudClient } from "@lacrous/omnicloud";

const client = new OmniCloudClient({ baseUrl: "https://my-omnicloud.example" });

await client.startTelegramLogin("+15551234567");
const result = await client.verifyTelegramCode("+15551234567", "12345");
if (result.status === "password_required") {
  await client.submitTelegramPassword("+15551234567", "••••••••");
}

const file = await client.uploadFile(
  { data: new Blob(["hello"]), name: "hello.txt" },
  { onProgress: (p) => console.log(`${p.percent}%`) },
);

await client.createFolder("Documents");
await client.search("hello");
```

The package also exports the server-side building blocks (`StorageProvider`,
`StorageEngine`, `TelegramStorageProvider`, `FileService`, `FolderService`,
`SearchService`) for building custom deployments. See
[`packages/sdk`](packages/sdk).

## Storage architecture

- **Telegram stores the bytes.** Files are sent as force-downloaded documents into the user's private channel; the message id is the "object id".
- **PostgreSQL stores the cloud.** Folders are purely virtual OmniCloud objects; files are metadata rows pointing at Telegram messages.
- **Integrity.** The SHA-256 of every upload is computed server-side and verified on download.
- See [`docs/storage.md`](docs/storage.md) for the full design and failure-handling rules.

## Security

See [`docs/security.md`](docs/security.md) for the current threat model and
hardening notes. Highlights: credentials/sessions are server-side only, all
API inputs are validated, every operation verifies ownership, filenames are
sanitized (no path traversal), client MIME types are never trusted, and
auth endpoints are rate-limited.

**Important:** end-to-end encryption is **not** implemented in v0.1 — Telegram
can technically access channel content. Don't treat OmniCloud as a zero-knowledge vault yet.

## Limitations (v0.1)

- Files are buffered in memory during transfer → practical size cap (`MAX_UPLOAD_MB`, default 256 MB)
- No trash/bin — deletes are permanent (folder delete is recursive)
- No sharing, public links, versioning, previews, or sync clients
- Single-process server (no clustering/distributed workers)
- Search is name-substring based (PostgreSQL only)

## Roadmap

- v0.2: streaming uploads/downloads, trash & restore, file previews
- v0.3: sharing & public links, alternative providers (S3, local, WebDAV)
- v1.0: end-to-end encryption, desktop/mobile sync clients

## Contributing

PRs are welcome! Please run `pnpm lint && pnpm test && pnpm build` before
submitting. For larger changes, open an issue first.

## License

[MIT](LICENSE) — © 2026 Lacrous
