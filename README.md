# OmniCloud

**A self-hosted personal cloud drive that stores your files in your own Telegram account.**

OmniCloud gives you a Google-Drive-style interface — folders, search, trash, stars, versions, storage statistics — while the actual bytes live in a private Telegram channel that only your account can read. PostgreSQL holds the logical filesystem; Telegram holds the files.

```bash
npm install @lacrous/omnicloud
npx omnicloud
```

`omnicloud` applies the database schema, starts the server and opens <http://localhost:4000> in your browser.

> **Telegram is the physical storage. PostgreSQL is the logical filesystem. OmniCloud is the cloud layer that ties them together.**

---

## Contents

- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Features](#features)
- [Requirements](#requirements)
- [Configuration](#configuration)
- [Telegram setup](#telegram-setup)
- [Command reference](#command-reference)
- [Running from source](#running-from-source)
- [API](#api)
- [SDK](#sdk)
- [Security](#security)
- [Backups](#backups)
- [Limitations](#limitations)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

---

## Quick start

You need Node.js 20 or newer, a PostgreSQL database, and a Telegram API application (free, about two minutes at [my.telegram.org](https://my.telegram.org)).

**1. Start PostgreSQL.** If you do not have one, this runs a local instance:

```bash
docker run -d --name omnicloud-postgres -p 5432:5432 \
  -e POSTGRES_USER=omnicloud -e POSTGRES_PASSWORD=omnicloud -e POSTGRES_DB=omnicloud \
  postgres:16-alpine
```

**2. Create a project directory with a `.env` file:**

```bash
mkdir my-omnicloud && cd my-omnicloud
npm init -y
npm install @lacrous/omnicloud
```

```ini
# .env
DATABASE_URL=postgresql://omnicloud:omnicloud@localhost:5432/omnicloud
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef
OMNICLOUD_ENCRYPTION_KEY=replace-with-output-of-openssl-rand-hex-32
```

Generate the encryption key with `openssl rand -hex 32` and paste the result in.

**3. Start OmniCloud:**

```bash
npx omnicloud             # applies the schema, starts the server, opens the browser
```

The schema is applied on every start; migrations that have already run are skipped. Use `npx omnicloud start --no-open` on servers without a desktop.

**4. Sign in.** Open <http://localhost:4000>, enter your phone number, and confirm the code Telegram sends you. OmniCloud creates a private channel named **OmniCloud Storage** in your account on first sign-in.

---

## How it works

```text
Browser ──► OmniCloud (one port: web app + /api)
                 │
                 ├── PostgreSQL ── users, folders, files, versions, trash, stars, activity
                 │
                 └── Storage engine
                        │
                        ▼
                 Telegram (MTProto)
                        │
                        ▼
                 Your private storage channel  ── the actual file bytes
```

- **Uploads** are streamed to a temporary spool on disk, hashed with SHA-256 while they are written, sent to Telegram, verified, and only then recorded in PostgreSQL. A failed Telegram upload never leaves a file that looks valid.
- **Downloads** stream from Telegram to the browser. The checksum is verified before the final bytes are sent.
- **Deleting** a file moves it to Trash. Nothing remote is touched until you delete it permanently, so restore is lossless.
- **Telegram sessions** are encrypted at rest with AES-256-GCM using `OMNICLOUD_ENCRYPTION_KEY`. They never reach the browser and are never logged.

See [`docs/architecture.md`](docs/architecture.md) for the full design.

---

## Features

**Files and folders**

- Drag-and-drop upload with progress, cancel and retry
- Folders with rename, move, star, and recursive trash and restore
- Rename, move, star, replace (creates a new version), trash, restore and permanent delete
- Batch actions on multiple selected items
- Grid and list views, breadcrumbs, context menus, a details panel, keyboard shortcuts

**Finding things**

- Search with a small query language: `type:pdf`, `size:>100MB`, `folder:Projects`, `starred:true`, `after:2026-01-01`, `name:report`
- Sorting by name, size, type, created or modified date, ascending or descending
- Starred and Recent views

**Trust and recovery**

- SHA-256 checksum stored for every file and verified on download
- Integrity scan that reports missing Telegram objects, size mismatches and (in deep mode) hash mismatches
- Reconciliation with a two-step repair: plan first, then apply. Repairs never delete Telegram messages
- Version history per file (the foundation; the full history UI is planned for v0.3)

**Operations**

- Storage dashboard: usage, per-type breakdown, largest files, trash size, optional quota
- Structured activity log of meaningful actions
- Health endpoints: `/api/health`, `/api/health/database`, `/api/health/ready`, `/api/health/live`
- Request IDs on every log line and error response

---

## Requirements

| Component  | Requirement                                                                   |
| ---------- | ----------------------------------------------------------------------------- |
| Node.js    | 20 or newer (22 recommended)                                                  |
| PostgreSQL | 14 or newer (the bundled Docker example uses 16)                              |
| Telegram   | An `api_id` and `api_hash` from [my.telegram.org](https://my.telegram.org)    |
| Network    | Outbound access to Telegram's servers; inbound access only to the server port |

---

## Configuration

Configuration comes from environment variables. The `omnicloud` command also reads a `.env` file in the current directory; variables already set in your shell always win.

| Variable                   | Required          | Default      | Purpose                                                                                          |
| -------------------------- | ----------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`             | yes               | —            | PostgreSQL connection string                                                                     |
| `TELEGRAM_API_ID`          | yes               | —            | Your Telegram application ID                                                                     |
| `TELEGRAM_API_HASH`        | yes               | —            | Your Telegram application hash                                                                   |
| `OMNICLOUD_ENCRYPTION_KEY` | yes in production | —            | 64 hex characters. Seals Telegram sessions at rest. **Back it up separately from the database.** |
| `HOST`                     | no                | `0.0.0.0`    | Address to listen on                                                                             |
| `PORT`                     | no                | `4000`       | Port to listen on                                                                                |
| `NODE_ENV`                 | no                | `production` | Set to `production` for real deployments (the `omnicloud` command defaults to it)                |
| `LOG_LEVEL`                | no                | `info`       | `fatal`, `error`, `warn`, `info`, `debug` or `trace`                                             |
| `COOKIE_SECURE`            | no                | `false`      | Set `true` when served over HTTPS                                                                |
| `ALLOWED_ORIGINS`          | no                | same-origin  | Comma-separated origins allowed to make state-changing requests                                  |
| `TRUST_PROXY`              | no                | `false`      | Trust `X-Forwarded-*` headers. Enable only behind a reverse proxy you control                    |
| `MAX_UPLOAD_MB`            | no                | `256`        | Largest accepted upload, in megabytes                                                            |
| `STORAGE_QUOTA_GB`         | no                | `0` (none)   | Optional quota shown on the Storage dashboard                                                    |
| `SESSION_SECRET`           | no                | —            | Reserved; browser sessions are server-side tokens and do not use it                              |

The repository includes a fully commented template at [`.env.example`](.env.example).

---

## Telegram setup

1. Go to [my.telegram.org](https://my.telegram.org), sign in, open **API development tools** and create an application.
2. Copy the **api_id** and **api_hash** into `TELEGRAM_API_ID` and `TELEGRAM_API_HASH`.
3. Start OmniCloud and sign in with your phone number. OmniCloud creates a private channel and stores each file as one message in it.

Your Telegram session stays on the server. It is stored encrypted in PostgreSQL, is never sent to the browser, and never appears in logs. The browser only receives OmniCloud's own session cookie. Details are in [`docs/telegram.md`](docs/telegram.md).

> OmniCloud runs as **your** Telegram account. Anyone who can use your account can read your files, and Telegram itself can read the channel content. End-to-end encryption is not implemented (see [Limitations](#limitations)).

---

## Command reference

The package installs one command, `omnicloud`:

| Command                        | What it does                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| `omnicloud`                    | Applies migrations, starts the server and opens the web app in your browser             |
| `omnicloud start`              | Same as `omnicloud`. Add `--no-open` to skip the browser                                |
| `omnicloud start --env <file>` | Reads configuration from a specific file instead of `.env`                              |
| `omnicloud migrate`            | Applies pending database migrations and regenerates the Prisma client, without starting |
| `omnicloud version`            | Prints the installed version                                                            |
| `omnicloud help`               | Prints usage                                                                            |

Run them with `npx omnicloud <command>` in your project directory, or add scripts to your `package.json`:

```json
{
  "scripts": {
    "start": "omnicloud"
  }
}
```

The server listens on `HOST:PORT` (default `0.0.0.0:4000`). The browser opens `127.0.0.1` when `HOST` is `0.0.0.0`.

### Running as a service

```bash
npx omnicloud start --no-open
```

Run it under a process manager such as `systemd`, `pm2` or Docker so it restarts after a crash or reboot. See [`docs/deployment.md`](docs/deployment.md) for example units and a reverse-proxy configuration.

---

## Running from source

Contributors and people who want to modify OmniCloud use the repository:

```bash
git clone https://github.com/Lacrous/OmniCloud.git
cd OmniCloud
pnpm install          # also generates the Prisma client and builds shared types
cp .env.example .env  # then fill in TELEGRAM_API_ID, TELEGRAM_API_HASH, OMNICLOUD_ENCRYPTION_KEY
docker compose up -d  # PostgreSQL on localhost:5432
pnpm db:migrate
pnpm dev              # API on :4000, web on :5173 (proxies /api)
```

Useful scripts:

| Command          | Purpose                              |
| ---------------- | ------------------------------------ |
| `pnpm dev`       | API and web app with hot reload      |
| `pnpm build`     | Build every package and the web app  |
| `pnpm test`      | Unit and integration tests           |
| `pnpm lint`      | ESLint                               |
| `pnpm typecheck` | TypeScript across the workspace      |
| `pnpm db:seed`   | Create a local user with sample data |

Building the npm package from source (what gets published). `prepack` builds the SDK, the CLI and the server bundle automatically:

```bash
cd packages/sdk && npm pack
```

The repository layout:

```text
apps/
├── web/        React, Vite and Tailwind web application
└── api/        Fastify HTTP server
packages/
├── core/       Domain logic, storage abstraction and services
├── telegram/   TelegramStorageProvider and the MTProto connection manager
├── database/   Prisma schema, migrations and repositories
├── shared/     DTOs, error codes, search parser and MIME helpers
└── sdk/        @lacrous/omnicloud: the SDK and the omnicloud command
```

---

## API

The full reference is [`docs/api.md`](docs/api.md). A summary:

```text
Health      GET  /api/health · /api/health/database · /api/health/ready · /api/health/live
Auth        POST /api/auth/telegram/start · verify · password · logout ; GET /api/auth/me
Storage     POST /api/storage/ensure · health/check · integrity/check ; GET /api/storage/health · stats
Files       GET  /api/files ; POST /api/files ; GET /api/files/:id · versions · download
            POST /api/files/:id/replace · move · trash · restore ; POST /api/files/batch
            PATCH /api/files/:id ; DELETE /api/files/:id (permanent)
Folders     GET  /api/folders · tree ; POST /api/folders ; PATCH /api/folders/:id
            POST /api/folders/:id/move · trash · restore ; POST /api/folders/batch
            DELETE /api/folders/:id (permanent)
Trash       GET  /api/trash ; POST /api/trash/empty
Collections GET  /api/starred · /api/recent · /api/search · /api/activity
```

List responses include pagination (`page`, `limit`, `total`, `hasMore`). Errors share one envelope with a request id:

```json
{ "error": { "code": "FILE_NOT_FOUND", "message": "File not found", "requestId": "..." } }
```

---

## SDK

The same package is a TypeScript SDK for applications that talk to an OmniCloud server:

```bash
npm install @lacrous/omnicloud
```

```ts
import { OmniCloudClient } from "@lacrous/omnicloud";

const cloud = new OmniCloudClient({ baseUrl: "https://my-omnicloud.example" });

const file = await cloud.files.upload(
  { data: new Blob(["hello"]), name: "hello.txt" },
  { onProgress: (p) => console.log(`${p.percent}%`) },
);

await cloud.folders.create("Documents");
await cloud.files.star(file.id);
const found = await cloud.search.query("type:txt size:<1KB");
```

Node applications can stream large downloads straight to disk with `downloadToFile`, and iterate `downloadStream` without buffering. The package also exports the server building blocks (`StorageEngine`, `TelegramStorageProvider`, the domain services) for custom deployments. See [`docs/sdk.md`](docs/sdk.md).

---

## Security

Highlights:

- Sessions are server-side tokens; the database stores only a hash, and logout revokes immediately
- Telegram sessions are encrypted at rest (AES-256-GCM) and never exposed
- Every operation checks ownership on the server; client-supplied user IDs are ignored
- Filenames are sanitized; client-declared MIME types are never trusted
- Authentication endpoints are rate-limited; requests are checked against an origin allowlist
- Responses carry strict security headers, including a content security policy for the web app
- Logs are redacted; passwords, codes, cookies and session strings are never written

> **Known advisory (operator action).** `npm audit` reports three high-severity findings
> through Prisma (`prisma`, `@prisma/config`, `deepmerge-ts`). To clear them in your
> installation, add `"overrides": { "deepmerge-ts": "^8.0.2" }` to your project's
> `package.json`, run `npm install`, then `npx omnicloud migrate`. Details are in
> [`docs/security.md`](docs/security.md#open-advisory-deepmerge-ts-via-prisma-operator-action).

See [`SECURITY.md`](SECURITY.md) and [`docs/security.md`](docs/security.md). To report a vulnerability, follow the process in `SECURITY.md` rather than opening a public issue.

---

## Backups

OmniCloud keeps data in two places, and a complete backup needs both:

| Data                                  | Where it lives                   | How to back it up                                   |
| ------------------------------------- | -------------------------------- | --------------------------------------------------- |
| Metadata, folders, versions, sessions | PostgreSQL                       | `pg_dump` on a schedule                             |
| File bytes                            | Your private Telegram channel    | Telegram keeps them; download important files too   |
| `OMNICLOUD_ENCRYPTION_KEY`            | Your environment or secret store | Store a copy apart from the database and the server |

Without the encryption key, a restored database cannot use its stored Telegram sessions. Without the database, the Telegram channel holds the bytes but no folder structure. See [`docs/deployment.md`](docs/deployment.md#backups).

---

## Limitations

- **No end-to-end encryption.** Telegram can access channel content, so OmniCloud is not a zero-knowledge vault.
- **Telegram is the storage backend.** Telegram's own rate limits, file-size rules and availability apply to you.
- **Single user per deployment.** There is no sharing, public links or multi-user collaboration yet.
- **Version history is a foundation.** You can see and restore versions in the details panel, but a full history UI and retention policies are planned for v0.3.
- Live verification of the Telegram path is documented in [`docs/limitations.md`](docs/limitations.md).

---

## Documentation

| Document                                               | Contents                                  |
| ------------------------------------------------------ | ----------------------------------------- |
| [`docs/architecture.md`](docs/architecture.md)         | System design and data flow               |
| [`docs/telegram.md`](docs/telegram.md)                 | Telegram connection, sessions and storage |
| [`docs/storage-provider.md`](docs/storage-provider.md) | The storage provider interface            |
| [`docs/storage.md`](docs/storage.md)                   | Upload, download, versions and integrity  |
| [`docs/api.md`](docs/api.md)                           | Full HTTP API reference                   |
| [`docs/sdk.md`](docs/sdk.md)                           | SDK reference                             |
| [`docs/security.md`](docs/security.md)                 | Threat model and operator guidance        |
| [`docs/deployment.md`](docs/deployment.md)             | Production setup, reverse proxy, backups  |
| [`docs/troubleshooting.md`](docs/troubleshooting.md)   | Common problems and fixes                 |
| [`docs/limitations.md`](docs/limitations.md)           | What this release does not guarantee      |
| [`CHANGELOG.md`](CHANGELOG.md)                         | Release history                           |

---

## Roadmap

- **v0.3** — version history UI and restore, trash retention, live Telegram verification in CI
- **v0.4** — alternative storage providers (S3, WebDAV, local disk), previews
- **v1.0** — end-to-end encryption, sync clients, collaboration

---

## Contributing

Pull requests are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md). Before submitting, run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, which is what CI runs. For larger changes, open an issue first.

---

## License

[MIT](LICENSE) © 2026 Lacrous
