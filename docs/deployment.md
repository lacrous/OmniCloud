# Deployment

This guide covers running OmniCloud in production: requirements, sizing, the
environment, the build, single-port serving, reverse proxying, migrations,
updates, monitoring, backups and the limits of a single-process install.

OmniCloud keeps the _logical_ filesystem — users, folders, files, versions,
trash, stars, activity, sessions and API tokens — in PostgreSQL, and the file
bytes in a private Telegram channel inside each user's own Telegram account.
A production install is therefore three things: a Node process, a PostgreSQL
database and an outbound connection to Telegram.

## Contents

- [Requirements](#requirements)
- [Sizing](#sizing)
- [Environment variables](#environment-variables)
- [Install from npm](#install-from-npm)
- [Deploy with Docker](#deploy-with-docker)
- [Deploy with systemd](#deploy-with-systemd)
- [Reverse proxy](#reverse-proxy)
- [Single-port serving](#single-port-serving)
- [Database migrations](#database-migrations)
- [Updating](#updating)
- [Health checks and monitoring](#health-checks-and-monitoring)
- [Trash retention](#trash-retention)
- [Update check](#update-check)
- [Backups](#backups)
- [Scaling limits](#scaling-limits)
- [Build from source](#build-from-source)
- [Custom domain](#custom-domain)

## Requirements

| Component                | Requirement                                                            |
| ------------------------ | ---------------------------------------------------------------------- |
| Node.js                  | 20 or newer (the package declares `engines.node: ">=20"`)              |
| Package manager          | npm for the published package; pnpm 12.x for a source checkout         |
| PostgreSQL               | 14 or newer (the bundled development database is `postgres:16-alpine`) |
| Telegram API credentials | An `api_id` / `api_hash` pair from <https://my.telegram.org>           |
| Outbound network         | TCP and TLS to Telegram's MTProto servers                              |

The API needs outbound network access to Telegram and inbound access to
nothing except the port it listens on. It never accepts an inbound
connection from Telegram.

> **Note:** the `api_id` / `api_hash` pair belongs to your deployment, not to
> a user. Each person who signs in does so with their own Telegram account
> and their own session; see [telegram.md](telegram.md).

## Sizing

OmniCloud runs as a single Node process. Size it around the work it does, not
around the amount of data it stores — the bytes live in Telegram, not on your
disk.

| Resource       | What drives it                                                    | Guidance                                                                                                                                                                      |
| -------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CPU            | One MTProto connection per signed-in user, plus request handling  | Hashing and encryption are per-request CPU work, so they scale with concurrent transfers rather than with stored data. Start with one core and watch how long requests queue. |
| Memory         | The Node process plus one live Telegram client per signed-in user | The process itself is modest; each signed-in user adds one MTProto connection held in memory. Measure the real figure on your install and set the limit from there.           |
| Temporary disk | Uploads are spooled to `os.tmpdir()` while they are hashed        | Keep at least `MAX_UPLOAD_MB` × the number of concurrent uploads free in the temp directory. This is the disk that runs out first on a small VPS.                             |
| Database disk  | Metadata only: rows for files, folders, versions and activity     | Small relative to the stored bytes, but the activity log and `FileVersion` rows grow with every upload and every version.                                                     |
| PostgreSQL     | A single database                                                 | The schema is plain PostgreSQL with no extensions. `pg_dump` is enough for backups.                                                                                           |

Two consequences worth planning for:

- **Uploads are written to disk, not held in memory.** The multipart body is
  streamed to a temporary file while the SHA-256 is computed
  (`packages/core/src/utils/spool.ts`). A larger `MAX_UPLOAD_MB` therefore
  costs temporary disk, not RAM. Point `TMPDIR` at a volume sized for it if
  `/tmp` is small.
- **Spool directories are cleaned up on the next start.** A process killed
  mid-upload can leave one behind; the server removes spools whose owning
  process is gone at startup (`sweepStaleSpools`).

> **Warning:** Telegram's own limits apply to you. One document is capped at
> 2 GB by Telegram (`MAX_DOCUMENT_BYTES` in the Telegram provider), and
> Telegram's flood limits apply per account. See
> [telegram.md](telegram.md).

## Environment variables

Loaded and validated by `apps/api/src/config.ts`. Invalid values fail at
startup, before the server listens.

| Variable                   | Required      | Default                             | Notes                                                                                                                                           |
| -------------------------- | ------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`             | yes           | —                                   | PostgreSQL connection string used by Prisma                                                                                                     |
| `TELEGRAM_API_ID`          | yes           | —                                   | Must be a non-zero integer; startup throws otherwise                                                                                            |
| `TELEGRAM_API_HASH`        | yes           | —                                   | Must be non-empty; startup throws otherwise                                                                                                     |
| `OMNICLOUD_ENCRYPTION_KEY` | in production | _(none)_                            | Seals Telegram session strings at rest (AES-256-GCM). Generate with `openssl rand -hex 32`. Losing it makes stored Telegram sessions unreadable |
| `SESSION_SECRET`           | no            | `development-only-secret-change-me` | Reserved. Browser sessions are server-side tokens and do not use it. Keep it set in production anyway                                           |
| `HOST`                     | no            | `0.0.0.0`                           | Interface the API binds                                                                                                                         |
| `PORT`                     | no            | `4000`                              | Must be a positive integer                                                                                                                      |
| `NODE_ENV`                 | no            | `development`                       | The `omnicloud` command sets `production`; `production` requires `OMNICLOUD_ENCRYPTION_KEY`                                                     |
| `LOG_LEVEL`                | no            | `info`                              | Fastify/pino level (`fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`)                                                               |
| `COOKIE_SECURE`            | no            | `false`                             | Set `true` when the browser reaches the server over HTTPS                                                                                       |
| `ALLOWED_ORIGINS`          | no            | _(unset: same-origin only)_         | Comma-separated origin allowlist for state-changing requests                                                                                    |
| `TRUST_PROXY`              | no            | `false`                             | Enables Fastify `trustProxy` so client IPs come from `X-Forwarded-For`                                                                          |
| `MAX_UPLOAD_MB`            | no            | `256`                               | Positive integer; multiplied by `1024 * 1024` to set the multipart file-size cap                                                                |
| `WEB_DIST_DIR`             | no            | _(unset)_                           | Directory of the built web app. When present and readable, the API serves the SPA from the same port                                            |
| `STORAGE_QUOTA_GB`         | no            | `0` (no quota)                      | Positive number sets the quota ceiling shown on the Storage dashboard. `0` or unset means no quota                                              |
| `TRASH_RETENTION_DAYS`     | no            | `30`                                | Days a trashed file or folder is kept. `0` keeps the trash indefinitely. Must be zero or a positive integer                                     |
| `UPDATE_PACKAGE_NAME`      | no            | `@hilbras/omnicloud`                | npm package polled for newer releases                                                                                                           |
| `UPDATE_CHECK_ENABLED`     | no            | `true`                              | Set `false` to disable the periodic npm check entirely                                                                                          |

Rules the validation applies:

- **Booleans** read only `true` as true, after trimming whitespace and
  ignoring case. `1`, `yes` and `on` are false.
- **Integers** (`PORT`, `MAX_UPLOAD_MB`, `TELEGRAM_API_ID`) must be
  positive. `0` and non-integers throw `<NAME> must be a positive integer`.
- **`TRASH_RETENTION_DAYS`** is checked separately: `0` is allowed and means
  "keep the trash forever". A negative value or a non-integer throws
  `TRASH_RETENTION_DAYS must be zero or a positive integer`.
- **`ALLOWED_ORIGINS`** is split on commas, trimmed, and empty entries are
  dropped. Each entry must be a full origin (`https://cloud.example`, no
  trailing slash) and is matched exactly against the `Origin` header.
- **`STORAGE_QUOTA_GB`** is read as a number rather than an integer, so `0`
  is valid there and means "no quota".

> **Note:** the quota is a display ceiling, not an enforcement. `STORAGE_QUOTA_GB`
> is passed to the stats service and shown on the Storage dashboard; nothing
> rejects an upload for exceeding it.

### The `.env` file and the `omnicloud` command

`omnicloud` reads the environment first and then a `.env` file in the current
directory, or the file named by `--env`. Variables already present in the
environment are never overwritten by the file.

```bash
npx omnicloud start --env /etc/omnicloud/production.env --no-open
```

> **Warning:** an empty `WEB_DIST_DIR=` line in your `.env` switches the
> bundled web application **off**. The CLI only sets the bundled path when
> `WEB_DIST_DIR` is unset (`env.WEB_DIST_DIR ??= …`), and an empty string
> counts as set. Leave the line out of the file, or give it a real path. See
> [Single-port serving](#single-port-serving).

## Install from npm

The published package `@hilbras/omnicloud` ships the server bundle, the built
web app and the Prisma schema. It installs one command, `omnicloud`.

```bash
mkdir omnicloud-app && cd omnicloud-app
npm init -y
npm install @hilbras/omnicloud
```

Put the configuration in `.env` in that directory (see the variable table
above), then:

```bash
npx omnicloud                    # applies migrations, starts the server, opens the browser
npx omnicloud start --no-open    # the same without opening a browser
```

Each start regenerates the Prisma client for the installed version and applies
pending migrations, so a fresh install and an upgrade need no extra step. See
[Database migrations](#database-migrations) for how to apply them on their
own.

The command sets two variables for the server process unless they are already
set:

| Variable       | Value set by the CLI   | Effect                                                   |
| -------------- | ---------------------- | -------------------------------------------------------- |
| `NODE_ENV`     | `production`           | Makes `OMNICLOUD_ENCRYPTION_KEY` mandatory               |
| `WEB_DIST_DIR` | `<package>/server/web` | Serves the bundled web app from the same port as the API |

> **Note:** `npm init -y` is only needed so the package lands in a project
> directory with its own `node_modules`. Any directory with a `package.json`
> works.

### What the package contains

```
node_modules/@hilbras/omnicloud/
├── dist/            # the SDK and the `omnicloud` CLI
└── server/
    ├── index.js     # the API, bundled from apps/api/src
    ├── web/         # the built web application
    └── prisma/      # schema.prisma and the migrations
```

The `server/index.js` bundle is self-contained except for the runtime
dependencies the package installs (`fastify`, `@fastify/*`, `@prisma/client`,
`prisma`, `telegram`). Running it directly skips the CLI's migration step:

```bash
node node_modules/@hilbras/omnicloud/server/index.js
```

Use the CLI in production, so migrations run before the server accepts
traffic.

## Deploy with Docker

The repository ships a development-only Compose file that starts PostgreSQL
alone (`docker-compose.yml`, port bound to loopback, a development password).
For production, build your own image from the published package.

```dockerfile
# Dockerfile
FROM node:22-bookworm-slim

# Prisma's query engine needs OpenSSL and a glibc-compatible base image.
# Alpine needs extra packages; the Debian slim image needs none.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Pin the version so an upgrade is a deliberate change.
RUN npm init -y \
  && npm install --omit=dev @hilbras/omnicloud@0.5.0 \
  && chown -R node:node /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    TMPDIR=/tmp/uploads

RUN mkdir -p /tmp/uploads && chown node:node /tmp/uploads

USER node

EXPOSE 4000
CMD ["/app/node_modules/.bin/omnicloud", "start", "--no-open"]
```

`chown -R node:node /app` matters: `omnicloud start` runs `prisma generate`
before it starts the server, and that writes into `node_modules/.prisma`. Run
the container as root and the generation works too, but the non-root user is
the better default.

A matching Compose file:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: omnicloud
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}
      POSTGRES_DB: omnicloud
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U omnicloud -d omnicloud"]
      interval: 5s
      timeout: 5s
      retries: 10

  omnicloud:
    build: .
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://omnicloud:${POSTGRES_PASSWORD}@postgres:5432/omnicloud
      TELEGRAM_API_ID: ${TELEGRAM_API_ID}
      TELEGRAM_API_HASH: ${TELEGRAM_API_HASH}
      OMNICLOUD_ENCRYPTION_KEY: ${OMNICLOUD_ENCRYPTION_KEY}
      COOKIE_SECURE: "true"
      TRUST_PROXY: "true"
      LOG_LEVEL: info
    ports:
      - "127.0.0.1:4000:4000"

volumes:
  postgres-data:
```

Notes for the container:

- **Publish the port on loopback** (`127.0.0.1:4000:4000`) and put a reverse
  proxy in front of it. The API has no TLS of its own.
- **Keep `OMNICLOUD_ENCRYPTION_KEY` out of the image.** Pass it as an
  environment variable from your secret store, and back it up separately from
  the database. See [Backups](#backups).
- **Do not bake `.env` into the image.** The CLI reads `.env` from the working
  directory, so a file baked into a layer would end up in the image history.
- **Mount a volume on `TMPDIR`** if `/tmp` is small and uploads are large.

## Deploy with systemd

Run the CLI under a supervisor so the process restarts after a crash or a
reboot. A minimal unit:

```ini
[Unit]
Description=OmniCloud
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
WorkingDirectory=/srv/omnicloud-app
ExecStart=/srv/omnicloud-app/node_modules/.bin/omnicloud start --no-open
Restart=on-failure
RestartSec=5
User=omnicloud
EnvironmentFile=/srv/omnicloud-app/.env

[Install]
WantedBy=multi-user.target
```

Points worth getting right:

- **Use the local binary, not `npx`.** `npx` may reach the network to resolve
  a missing package, and a unit that depends on the npm registry stops
  starting when the registry is unreachable. Adjust the path to the output of
  `which node` if you prefer
  `ExecStart=/usr/bin/node /srv/omnicloud-app/node_modules/@hilbras/omnicloud/dist/cli.js start --no-open`.
- **`EnvironmentFile` and `.env` are two different mechanisms.** The unit's
  `EnvironmentFile` is read by systemd. The CLI additionally reads a `.env`
  in the working directory. Use one, not both, or make sure they agree.
- **Keep the file readable only by the service user.** It holds
  `OMNICLOUD_ENCRYPTION_KEY` and the Telegram credentials.
- **Pin the version** (`npm install @hilbras/omnicloud@0.5.0`) so upgrades
  happen deliberately.

Check the unit and follow the logs:

```bash
systemctl daemon-reload
systemctl enable --now omnicloud
systemctl status omnicloud
journalctl -u omnicloud -f
```

## Reverse proxy

Recommended topology: a TLS-terminating reverse proxy (nginx, Caddy, Traefik)
in front of the API.

- **HTTPS:** terminate TLS at the proxy; the API speaks plain HTTP internally.
- **`COOKIE_SECURE=true`:** required so the session cookie is only sent over
  HTTPS. The cookie is `HttpOnly` and `SameSite=Lax`; without the `Secure`
  flag it would travel over plain HTTP.
- **`TRUST_PROXY=true`:** so Fastify derives the client IP from
  `X-Forwarded-For`. The auth rate limiter keys on `request.ip`; without this
  every client shares the proxy's IP and hits the 10-per-minute limit
  together.
- **`ALLOWED_ORIGINS`:** if the UI is served from a different origin than the
  API, list those origins explicitly. Same-origin deployments can leave it
  unset — the check falls back to comparing the request `Origin` host to the
  `Host` header.

### nginx

```nginx
server {
  listen 443 ssl;
  server_name cloud.example;

  ssl_certificate     /etc/letsencrypt/live/cloud.example/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/cloud.example/privkey.pem;

  # nginx rejects bodies over 1 MB by default, before OmniCloud sees them.
  # Keep this at or above MAX_UPLOAD_MB.
  client_max_body_size 300m;

  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;

    # The Origin/Host comparison needs the real Host header.
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;

    # Stream uploads through instead of buffering them to nginx's disk.
    proxy_request_buffering off;

    # Long transfers to Telegram can outlast the default 60s read timeout.
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
  }
}

server {
  listen 80;
  server_name cloud.example;
  return 301 https://$host$request_uri;
}
```

### Caddy

```caddy
cloud.example {
  reverse_proxy 127.0.0.1:4000 {
    header_up X-Forwarded-Host {host}
  }
}
```

Caddy obtains and renews certificates itself, sets `X-Forwarded-For` and
`X-Forwarded-Proto`, and does not impose a request body limit.

### Headers

The API sets its own security headers on every response
(`apps/api/src/http.ts`), and a `Content-Security-Policy` on pages it serves
from the SPA:

| Header                              | Value                                      |
| ----------------------------------- | ------------------------------------------ |
| `X-Content-Type-Options`            | `nosniff`                                  |
| `X-Frame-Options`                   | `DENY`                                     |
| `Referrer-Policy`                   | `no-referrer`                              |
| `Cross-Origin-Resource-Policy`      | `same-origin`                              |
| `Cross-Origin-Opener-Policy`        | `same-origin`                              |
| `Permissions-Policy`                | `geolocation=(), microphone=(), camera=()` |
| `X-Permitted-Cross-Domain-Policies` | `none`                                     |
| `Content-Security-Policy`           | Set by the API, only on SPA pages          |

Do not strip these in the proxy. If the proxy adds its own
`Content-Security-Policy`, the API's `onSend` hook overwrites it for served
pages, so the two policies do not merge.

## Single-port serving

When `WEB_DIST_DIR` is set to the web app's build output **and that directory
exists**, the API registers static file serving and a SPA fallback:

- `GET` requests that do not start with `/api/` and do not match a file are
  answered with `index.html`.
- Anything else falls through to the JSON not-found handler
  (`404 NOT_FOUND`).

This lets one process on one port serve both the API and the UI. Without
`WEB_DIST_DIR`, unknown routes return JSON `404` and the UI must be served
separately and configured to call the API (same origin, or an allowed
origin).

The published package sets this up for you: `omnicloud start` points
`WEB_DIST_DIR` at `<package>/server/web`, so one port serves both the API and
the built web app.

To serve the UI separately, leave `WEB_DIST_DIR` unset and put both the
static files and the API behind the same origin — a path-based proxy rule
that sends `/api/` to the API and everything else to the static files — or
serve them from different origins and list the UI's origin in
`ALLOWED_ORIGINS`.

> **Warning:** the static handler reads `index.html` from `WEB_DIST_DIR` at
> startup. If the directory exists but has no `index.html`, the server fails
> to start with an `ENOENT` error. If the directory does not exist at all, the
> server starts normally and simply serves no UI.

## Database migrations

Migrations live in `packages/database/prisma/migrations/` and are applied with
`prisma migrate deploy`, which never prompts and is safe to run repeatedly.

| Migration                      | Content                                                                                                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0_init`                       | Users, Telegram sessions, storage registrations, folders, files                                                                                                 |
| `1_v02_reliability`            | Adds `starred`, `deletedAt`, `currentVersionId`, `versionCount`; creates `FileVersion` and `ActivityEvent`; new indexes; backfills version 1 for pre-v0.2 files |
| `2_v02_trash_batch`            | Adds `trashBatchId` to `File` and `Folder`                                                                                                                      |
| `3_browser_sessions`           | Server-side browser sessions (token hashes, expiry, revocation)                                                                                                 |
| `4_upload_operations`          | Upload operation records used for idempotent uploads and recovery                                                                                               |
| `5_upload_request_fingerprint` | Binds an upload idempotency key to the request that created it                                                                                                  |
| `6_api_tokens`                 | Personal API tokens; only a SHA-256 hash of each secret is stored                                                                                               |
| `7_fk_indexes`                 | Leading indexes on `Folder.parentId` and `File.folderId`                                                                                                        |
| `8_encryption_fields`          | `encryptionFormat`, `wrappedKey`, `metadataBlob`, `keyEpoch` on `File` and `FileVersion`                                                                        |
| `9_user_recovery_blob`         | The OCE1 recovery blob on `User`                                                                                                                                |
| `10_file_current_version_fk`   | Foreign key and unique index from `File.currentVersionId` to `FileVersion`                                                                                      |

Apply them with the published package by starting it. `omnicloud start` runs
`prisma generate` and then `prisma migrate deploy` against the schema bundled
in the package (`server/prisma/schema.prisma`), and only then starts the
server:

```bash
npx omnicloud start --no-open
```

or from a source checkout:

```bash
pnpm db:migrate
```

> **Note:** `omnicloud migrate` is overloaded. Bare, it applies the database
> migrations. With a file id (or `all`), it encrypts legacy plaintext files.
> The argument decides which one runs.

### Running migrations in production

1. **Back up the database first.** See [Backups](#backups). Every migration
   is additive, but a backup is the only way back from a mistake.
2. **Apply them from the release host**, not from every replica. OmniCloud is
   a single process, so this is one command:

   ```bash
   npx omnicloud migrate
   ```

   That applies the pending migrations and regenerates the Prisma client, and
   exits `0` when the schema is already up to date, so it is safe to run
   unconditionally on every deploy. To run Prisma directly instead:

   ```bash
   node_modules/.bin/prisma migrate deploy \
     --schema node_modules/@hilbras/omnicloud/server/prisma/schema.prisma
   ```

   Starting the server does the same thing: `omnicloud start` runs
   `prisma generate` and `prisma migrate deploy` before it listens.

3. **Stop the old process, then start the new one.** The migrations are
   backward compatible with the previous release, so a short overlap is
   tolerable, but a clean stop/start is simpler to reason about.
4. **Verify.** `prisma migrate deploy` records every applied migration in the
   `_prisma_migrations` table:

   ```sql
   SELECT migration_name, finished_at IS NOT NULL AS applied
     FROM "_prisma_migrations"
    ORDER BY finished_at;
   ```

5. **Check the version backfill** after an upgrade from 0.1:

   ```sql
   SELECT count(*) FROM "File" WHERE "versionCount" = 0;
   SELECT count(*) FROM "FileVersion";
   ```

For local schema work use `prisma migrate dev` (the database package's
`migrate:dev` script). Never run it against a production database: it can
reset it.

> **Note:** `prisma migrate deploy` fails with a divergence error when the
> database schema has been changed outside the migration history. Reconcile
> the schema by hand rather than resetting it in production.

## Updating

OmniCloud is published to npm as `@hilbras/omnicloud`. Releases are cut from
a tag; the release workflow builds the package, verifies the version against
every manifest in the repository, and smoke-tests the packed tarball in a
clean project before it is published.

To update an installation:

```bash
cd /srv/omnicloud-app
npm install @hilbras/omnicloud@0.5.0   # pin the version you want
systemctl restart omnicloud            # or: docker compose up -d --force-recreate omnicloud
```

Restarting runs `prisma generate` and `prisma migrate deploy` before the
server listens, so the schema is applied as part of the restart. To apply the
migrations separately, stop the service, run the same `prisma migrate deploy`
against the package's schema, and start it again:

```bash
node_modules/.bin/prisma migrate deploy \
  --schema node_modules/@hilbras/omnicloud/server/prisma/schema.prisma
```

The `prisma` binary is installed as a dependency of `@hilbras/omnicloud`, so
`node_modules/.bin/prisma` is present in the application directory.

Then confirm the running version:

```bash
curl -s https://cloud.example/api/health | jq .version
npx omnicloud version
```

Notes:

- **Pin the version.** `npm install @hilbras/omnicloud` moves to the newest
  published release whenever you run it. `@0.5.0` makes the upgrade
  deliberate.
- **The restart migrates on its own.** `omnicloud start` applies the pending
  migrations before the server listens, so the schema and the process come up
  together. Apply them separately when you want the schema verified before
  the new process takes traffic.
- **Take a database backup before the upgrade.** The new release may add
  columns and tables; the old release keeps working with them, but the
  backup is your rollback.
- **The web app is part of the package.** A version bump updates the served
  UI as well; there is no separate web deploy.
- **The sidebar shows an update notice** when the server's hourly npm check
  finds a newer published version. See [Update check](#update-check).

## Health checks and monitoring

All four probes are public: they need no session and no API token.

| Endpoint                   | Auth | Checks                             | Status                            | Use                                                |
| -------------------------- | ---- | ---------------------------------- | --------------------------------- | -------------------------------------------------- |
| `GET /api/health/live`     | none | nothing — the process is up        | always `200`                      | Liveness probe. Never touches a dependency.        |
| `GET /api/health/ready`    | none | database, encryption configuration | `200` when ready, `503` otherwise | Readiness probe. Use this one for a load balancer. |
| `GET /api/health`          | none | database                           | always `200`                      | Legacy probe; health is reported in the body.      |
| `GET /api/health/database` | none | database                           | always `200`                      | Database-only check.                               |

Liveness deliberately checks no dependency, so a database outage does not make
an orchestrator restart a process that would otherwise recover. Readiness
requires the database to answer and the encryption key to be configured;
storage is not part of readiness, because a user may not have connected
Telegram yet and sign-in must keep working.

`GET /api/health/ready` response:

```json
{
  "ready": true,
  "checks": [
    { "name": "database", "state": "healthy", "detail": null },
    { "name": "encryption", "state": "healthy", "detail": null }
  ]
}
```

`GET /api/health` response:

```json
{
  "status": "healthy",
  "database": "healthy",
  "storage": "unknown",
  "uptimeSeconds": 3600,
  "version": "0.5.0"
}
```

`GET /api/health` and `GET /api/health/database` always return HTTP `200`;
the state is in the body (`healthy` or `unavailable`). Alert on
`database = unavailable`, or on `ready: false` from the readiness probe.

Example probe commands:

```bash
curl -fsS https://cloud.example/api/health/live  > /dev/null   # liveness
curl -fsS https://cloud.example/api/health/ready > /dev/null   # readiness
curl -sS https://cloud.example/api/health | jq '.database'       # database state
```

### Per-user storage health

These need a session and are about one user's Telegram channel, not about the
process:

| Endpoint                            | Purpose                                                         |
| ----------------------------------- | --------------------------------------------------------------- |
| `GET /api/storage/health`           | Cached storage health plus statistics (no Telegram round-trip)  |
| `POST /api/storage/health/check`    | Fresh probe; `{ "deep": true }` does a real Telegram round-trip |
| `POST /api/storage/integrity/check` | Read-only drift report; `{ "deep": true }` re-hashes the bytes  |
| `POST /api/storage/reconciliation`  | Read-only comparison of the channel with the database           |

A deep probe is the right readiness signal for storage, but do not poll it
aggressively — every deep check costs Telegram rate budget.

### Logs

Logs are structured JSON from Fastify/pino. Each line carries the request id
(`x-request-id`), so an error report can be correlated with both the API
response and the log stream:

```bash
journalctl -u omnicloud --since "10 min ago" | grep 3f1c2b9e
```

Passwords, codes, cookies and session strings are never written to the log.

## Trash retention

Trashed files and folders are kept for `TRASH_RETENTION_DAYS` days (default 30) and are then removed for good. The server runs the purge every six hours
for every user, and also on startup, so expired items disappear without
anyone having to empty the trash by hand.

- `GET /api/trash/retention` reports the configured period; the web trash
  page shows it, so users know how long they have.
- `POST /api/trash/purge` runs the purge for the calling user on demand.
- The purge removes a file's Telegram message before its database record, as
  `POST /api/trash/empty` does. A file whose remote delete fails keeps its
  record, so the object can be found and cleaned up later rather than being
  stranded.
- A trashed folder is removed only once it holds nothing, so a file trashed
  more recently than its folder keeps the folder alive until it is eligible
  too.

> **Warning:** the purge is a **permanent deletion**. There is no undo, so a
> retention period shorter than your users expect is a data-loss risk rather
> than a storage saving.

> **Note:** setting `TRASH_RETENTION_DAYS=0` keeps the trash indefinitely:
> the purge is skipped and nothing is removed automatically. See
> [Environment variables](#environment-variables).

## Update check

The server polls the npm registry once an hour for the newest published
version of `UPDATE_PACKAGE_NAME` and caches the result. The web app reads
that cached result and shows a notice under the app title in the sidebar when
a newer version exists.

| Endpoint                | Auth | Purpose                                      |
| ----------------------- | ---- | -------------------------------------------- |
| `GET /api/update/check` | none | The cached result of the last registry check |

The endpoint is public because it exposes only the running version and the
newest published version of an open-source package — no user data. It returns
one of:

| `status`           | Meaning                                                          |
| ------------------ | ---------------------------------------------------------------- |
| `update_available` | A newer version is published; the sidebar shows a notice         |
| `up_to_date`       | The published version is the same or older                       |
| `not_published`    | The package does not exist on npm yet                            |
| `unknown`          | The registry could not be reached; the last error is in `detail` |

Behavior worth knowing:

- The registry is contacted **at most once an hour**, regardless of how many
  browsers are open, because the result is cached server-side. Polling
  `/api/update/check` from many clients does not multiply the traffic.
- A failed check never raises: it is reported as `unknown` and retried on the
  next interval. It also never blocks startup.
- The check makes one outbound HTTPS request per hour to
  `registry.npmjs.org`. Set `UPDATE_CHECK_ENABLED=false` to disable it in
  environments that must not make outbound requests.
- Only `update_available` renders a notice. An unpublished package or a
  failed lookup is deliberately not shown, so the badge stays meaningful.

## Backups

A complete backup has three parts. OmniCloud stores metadata in PostgreSQL
and bytes in a Telegram channel, and it seals the Telegram sessions with a
key that lives in neither.

| Data                                              | Where it lives                                         | How to recover it                                           |
| ------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------- |
| Files, folders, versions, metadata, `Storage` row | PostgreSQL                                             | Restore the database backup                                 |
| File bytes                                        | The user's private Telegram channel                    | Telegram keeps them; the database maps names to them        |
| Telegram sessions                                 | PostgreSQL, **sealed** with `OMNICLOUD_ENCRYPTION_KEY` | Needs the key. Without it, users sign in again              |
| The encryption key itself                         | Your environment or secret store, **not** the database | Back it up separately, in a secrets manager or offline copy |

### Backing up the database

The database holds the only mapping from user-visible file names and folder
structure to Telegram messages. The Telegram channel contains opaque
documents; without the database there is no way to reconstruct which message
is which file, and a lost `Storage` row (channel id + access hash) makes the
channel effectively inaccessible to OmniCloud.

```bash
# Custom format: compressed, and restorable table by table.
pg_dump --format=custom --no-owner \
  --file="omnicloud-$(date -u +%Y%m%dT%H%M%SZ).dump" \
  "$DATABASE_URL"
```

Store the dumps off-host, and keep more than one generation. A managed
PostgreSQL provider's snapshots work equally well.

The tables that are irreplaceable are `File` / `FileVersion` (message
references and checksums) and `Storage` (channel id + access hash). `User`
and `TelegramSession` can be recreated by signing in again.

> **Warning:** do not back up the Telegram session string into places with
> broader access than the database itself. Sealed with
> `OMNICLOUD_ENCRYPTION_KEY`, it still grants full account access to anyone
> who has both the row and the key.

### Backing up the Telegram channel

Telegram holds the bytes; OmniCloud never copies them. You cannot `pg_dump`
them and there is no export command. What you can do:

- **Keep the channel.** Deleting the "OmniCloud Storage" channel makes the
  files unrecoverable. `POST /api/storage/ensure` creates a _new_ channel
  when the old one is gone; it does not restore the old one.
- **Copy what matters elsewhere.** For files you cannot afford to lose,
  download them to a second system. The Storage dashboard shows the largest
  files and the totals per category.
- **Check the channel against the database.** `POST /api/storage/reconciliation`
  reports channel messages that no record references (`unknown`) and records
  whose message is gone (`dangling`). Run it after a suspected incident to
  see what is still there.

> **Note:** restoring a database backup only makes sense against the same
> Telegram account and channel. Restoring into a different account produces
> metadata that points at messages that do not exist, visible as `missing` in
> an integrity report and as `dangling` in a reconciliation report.

### Backing up the encryption key

`OMNICLOUD_ENCRYPTION_KEY` seals the stored Telegram session strings with
AES-256-GCM. It is not in the database and it is not in the backup.

```bash
openssl rand -hex 32   # generate one, once
```

Store it in a secrets manager, or as an offline copy, **apart from** the
database backups — so that one compromise does not expose both.

A database backup restored without the matching key keeps all files and
folders, but every stored Telegram session becomes unreadable and users sign
in again. That is safe, but it is an outage for each of them. Keep the key
stable: changing it without re-sealing makes existing sessions unreadable in
the same way.

The key may be a 64-character hex string (preferred, used as-is) or a
passphrase of at least 32 characters, which is stretched with scrypt.

### Restore order

Restore in this order. The order matters: the database and the key have to be
in place before the server starts, or the server comes up without usable
Telegram sessions.

1. **Stop OmniCloud.** Do not let it write while you restore.
2. **Restore `OMNICLOUD_ENCRYPTION_KEY`** into the environment or secret
   store. It must be the same key the sessions were sealed with.
3. **Restore the database:**

   ```bash
   createdb omnicloud                       # if the database does not exist yet
   pg_restore --dbname "$DATABASE_URL" --clean --if-exists omnicloud-20261021T120000Z.dump
   ```

   `--clean` drops the existing objects first, so the restore reproduces the
   dump exactly rather than merging into whatever was there.

4. **Apply any pending migrations.** The dump may predate the current
   release:

   ```bash
   node_modules/.bin/prisma migrate deploy \
     --schema node_modules/@hilbras/omnicloud/server/prisma/schema.prisma
   ```

   This is safe on an already-current schema. Starting the server in step 5
   applies the same migrations, so this step is optional.

5. **Start OmniCloud** and watch the log:

   ```bash
   systemctl start omnicloud
   journalctl -u omnicloud -f
   ```

6. **Verify:**

   ```bash
   curl -fsS https://cloud.example/api/health/ready | jq .
   ```

   Expect `ready: true` with a `healthy` database and a `healthy` encryption
   check. Then sign in and confirm the Storage dashboard lists the expected
   files and folders, and that a small file downloads and matches its
   checksum.

> **Warning:** a restore into a different Telegram account or a different
> channel produces metadata that points at messages which do not exist. The
> files show as `missing` in an integrity report. Restore into the same
> account, or accept that the affected files are lost.

### Restore drill

A backup you have never restored is a hypothesis. Run the drill on a schedule
— quarterly is a reasonable default — and record the result.

1. Provision a scratch PostgreSQL database and a scratch copy of the
   environment (never the production one).
2. Restore the newest dump into it.
3. Restore `OMNICLOUD_ENCRYPTION_KEY` into it.
4. Apply the migrations against it:

   ```bash
   node_modules/.bin/prisma migrate deploy \
     --schema node_modules/@hilbras/omnicloud/server/prisma/schema.prisma
   ```

5. Start the server against the scratch database and check
   `GET /api/health/ready`.
6. Sign in with the Telegram account that owns the channel and confirm the
   folder tree and a sample file download correctly.
7. Record the date, the dump you used and the outcome. A failed drill is the
   most useful result you can get.

Also check the parts a database dump does not cover: is the encryption key
still readable from your secret store, and is the Telegram channel still
there?

## Scaling limits

OmniCloud is designed as a **single-process** application:

- **In-memory rate limiting.** The auth limiter is a per-process fixed
  window; it does not coordinate across replicas.
- **Per-user MTProto connections.** One connection per user per process;
  multiple replicas would each hold their own session for the same account,
  which is out of scope and can trigger Telegram session duplication.
- **Uploads use disk, not memory.** Each upload is written to a temporary
  directory while it is hashed. Concurrency is bounded by the free space in
  that directory (`os.tmpdir()`) and by `MAX_UPLOAD_MB`, not by process
  memory.
- **One PostgreSQL database, one Telegram account per user.** There is no
  Redis, no external queue and no shared cache.

Scale vertically (more CPU and RAM for the Node process) rather than
horizontally. If you need multiple instances, put them behind a deployment
that pins each user to a single process and introduce shared state for rate
limiting — neither is provided.

The current list of what OmniCloud does not guarantee lives in
[limitations.md](limitations.md).

## Build from source

From the repository root:

```bash
pnpm install
pnpm db:generate    # prisma generate
pnpm db:migrate     # prisma migrate deploy
pnpm build          # build:types, then every package
```

`postinstall` already runs `db:generate` and `build:types`, so a fresh
install is close to ready; run `db:migrate` explicitly against each
environment.

Workspace scripts:

| Script             | Action                                               |
| ------------------ | ---------------------------------------------------- |
| `pnpm db:generate` | `prisma generate` (required before the API compiles) |
| `pnpm db:migrate`  | `prisma migrate deploy` (applies pending migrations) |
| `pnpm build`       | Build type declarations and all packages             |
| `pnpm dev:api`     | Run the API in watch mode (development)              |

> **Note:** the SDK declaration bundle (`packages/sdk`, `dts.resolve: true`)
> inlines the whole workspace type graph. Its build script sets
> `--max-old-space-size=4096` for that reason. Running `tsup` without the flag
> can fail with `ERR_WORKER_OUT_OF_MEMORY`. Keep the flag when changing the
> SDK build.

## Custom domain

The web build takes its canonical origin from `VITE_SITE_URL`. It is inlined
at build time and drives the canonical link, Open Graph and Twitter tags, the
JSON-LD `@id`/`url`/`logo` fields, `robots.txt` and `sitemap.xml`.

```bash
VITE_SITE_URL=https://cloud.example.com pnpm --filter @omnicloud/web build
```

Leaving it unset falls back to the default Vercel deployment URL. Changing it
requires a rebuild, because the value is baked into the static output.

Steps to attach a domain to the Vercel project:

1. Add the domain in the Vercel project settings (**Settings → Domains**).
2. Point the domain's DNS at Vercel — either a `CNAME` to
   `cname.vercel-dns.com` or an `A` record to Vercel's anycast addresses, as
   Vercel shows for the domain.
3. Set `VITE_SITE_URL=https://your.domain` in the deployment's environment
   variables and redeploy so the build picks it up.
4. Confirm the built output: `dist/index.html` must contain zero occurrences
   of the old domain, and `dist/robots.txt` must list
   `Sitemap: https://your.domain/sitemap.xml`.

`apps/web/src/lib/site-url.ts` is the single runtime source of truth and
falls back to the same default, so per-route canonical URLs produced by
`usePageMeta` always match the static tags.
