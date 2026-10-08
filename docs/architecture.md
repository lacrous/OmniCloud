# Architecture (v0.2)

OmniCloud turns a user's own Telegram account into the object store for a
self-hosted cloud drive. PostgreSQL holds the entire logical structure;
Telegram holds only opaque file content. v0.2 is the "Reliability & Storage
Experience" release: the layered pipeline gains retries, progress,
cancellation, health checks, streaming, trash/restore with batch semantics and
read-only integrity verification.

## Layered design

```text
┌──────────────────────────────────────────────┐
│ Web app (@omnicloud/web)                     │  React SPA
└──────────────────────┬───────────────────────┘
                       │ HTTP (cookie session, JSON, multipart)
┌──────────────────────▼───────────────────────┐
│ API (apps/api, Fastify)                      │  routing, validation,
│  routes → auth hook → error handler          │  mapping DTOs
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│ Core services (packages/core)                │  domain logic
│  FileService FolderService SearchService     │
│  StatsService TrashService IntegrityService  │
│  RecentService ActivityService               │
│  (query-resolver)                            │
└───────┬──────────────────────────┬───────────┘
        │ Repos interfaces         │ StorageEngine
┌───────▼─────────┐      ┌─────────▼───────────┐
│ @omnicloud/     │      │ StorageEngine        │  sha256, retry,
│ database        │      │ (provider-agnostic)  │  progress, cancel
│ (Prisma)        │      └─────────┬───────────┘
└───────┬─────────┘                │ StorageProvider
        │                          ▼
        │              ┌───────────────────────┐
        │              │ TelegramStorageProvider│
        │              └─────────┬─────────────┘
        │                        │ MTProto (GramJS)
┌───────▼─────────┐    ┌─────────▼─────────────┐
│ PostgreSQL      │    │ Private Telegram       │
│ (metadata)      │    │ channel "OmniCloud     │
│                 │    │ Storage" (file bytes)  │
└─────────────────┘    └────────────────────────┘
```

Two dependency directions matter:

- **Services depend on repository interfaces, not on Prisma.** The interfaces
  live in `packages/core/src/repos.ts`; the Prisma implementation lives in
  `packages/database/src/index.ts`. Tests substitute in-memory repositories.
- **Services never import Telegram types.** They talk to a `StorageProvider`
  through a `StorageEngine`; `packages/telegram` is the only package that knows
  about MTProto.

## What PostgreSQL owns vs what Telegram owns

| Concern                              | Owner             | Notes                                                                      |
| ------------------------------------ | ----------------- | -------------------------------------------------------------------------- |
| File bytes                           | Telegram          | One document message per version in the user's private channel             |
| Object reference                     | PostgreSQL        | `File.telegramMessageId` / `FileVersion.telegramMessageId`                 |
| File name, size, MIME type, SHA-256  | PostgreSQL        | `File` / `FileVersion` rows                                                |
| Folder hierarchy                     | PostgreSQL        | Folders are virtual; no Telegram counterpart                               |
| Trash state, stars, version pointers | PostgreSQL        | `deletedAt`, `trashBatchId`, `starred`, `currentVersionId`, `versionCount` |
| Telegram session string              | PostgreSQL        | `TelegramSession`, server-side only                                        |
| Storage registration                 | PostgreSQL        | `Storage` (provider, channel id, access hash, title)                       |
| Activity events                      | PostgreSQL        | `ActivityEvent`                                                            |
| Browser session                      | Signed JWT cookie | Not a database row                                                         |

The critical operational consequence: **PostgreSQL is the only map from file
names to Telegram messages.** A Telegram channel without the database is
ciphertext; a database without the channel is a catalog of missing objects.

## Data model

Defined in `packages/database/prisma/schema.prisma`.

### `User`

Telegram identity mapped to an OmniCloud account. `telegramUserId` is `BigInt`
and unique; Telegram identifiers exceed JavaScript's safe-integer range and are
converted to strings at the repository boundary.

Key fields: `id`, `telegramUserId` (unique), `username`, `firstName`,
`lastName`, `phone`, `createdAt`, `updatedAt`.

### `TelegramSession`

The MTProto session string for the user's connected Telegram account.

Key fields: `userId` (unique, cascade delete), `stringSession`.

Why: MTProto sessions must survive process restarts so storage reconnects
lazily. The value is never exposed through the API and never logged.

### `Storage`

The user's private storage channel used as the backing object store.

Key fields: `userId`, `provider` (default `"telegram"`), `title`,
`telegramChatId` (`BigInt`), `telegramAccessHash` (`BigInt`), unique
`(userId, provider)`.

Why: every provider call builds an explicit `InputPeerChannel` from the raw id
and access hash, so entity resolution never depends on client-side caches.

### `Folder`

Virtual hierarchy node; `deletedAt` is the Trash marker.

Key fields: `userId`, `parentId` (self-relation, `onDelete: Restrict`), `name`,
`starred`, `deletedAt`, `trashBatchId`, `createdAt`, `updatedAt`.

Why `trashBatchId`: restoring a folder must restore exactly the subtree that
was trashed with it and leave separately-trashed items alone. Timestamp
equality is fragile; a shared opaque batch id is exact. It is `null` for empty
or individually-trashed rows.

Indexes: `(userId, parentId, deletedAt)`, `(userId, deletedAt)`,
`(userId, name)`, `(userId, starred)`.

### `File`

Current metadata for a file; points at one Telegram message and one version
row.

Key fields: `userId`, `folderId` (`onDelete: SetNull`), `name`, `size`
(`BigInt`), `mimeType`, `sha256`, `telegramMessageId` (`BigInt`), `starred`,
`deletedAt`, `trashBatchId`, `currentVersionId`, `versionCount`, timestamps.

Why: `telegramMessageId` is the live object reference; `currentVersionId`
links the version row content is served from; `deletedAt`/`trashBatchId` give
lossless trash; `starred` is a first-class column so starred listings are
indexed.

Indexes: `(userId, folderId, deletedAt)`, `(userId, deletedAt)`,
`(userId, name)`, `(userId, starred)`, `(userId, size)`, `(userId, mimeType)`.

### `FileVersion`

Version foundation for v0.3's version UI. Every upload creates version 1;
replacing appends a version and repoints the file.

Key fields: `fileId`, `userId`, `versionNumber`, `size`, `mimeType`, `sha256`,
`telegramMessageId`, unique `(fileId, versionNumber)`.

Each version holds its own `telegramMessageId`, so older versions remain
independently retrievable and are cleaned up on permanent delete.

### `ActivityEvent`

Structured audit/observability events.

Key fields: `userId`, `action`, `resourceType`, `resourceId`, `resourceName`,
`metadata` (`Json?`), `createdAt`.

Indexes: `(userId, createdAt)`, `(userId, resourceId, createdAt)`,
`(createdAt)`. The last supports retention pruning.

## Service map

All services live in `packages/core/src/services/` and are instantiated once per
process by the API container (`apps/api/src/container.ts`).

| Service            | Responsibility                                                                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FileService`      | Upload (with version 1), replace, list/query, get, download + integrity check, rename, star, move, trash, restore, permanent delete, batch operations                  |
| `FolderService`    | Create, list children, query, tree, rename, star, move (cycle-checked), subtree trash/restore (batch semantics), permanent subtree delete, batch                       |
| `SearchService`    | Parses the v0.2 query language and evaluates it through the repositories; PostgreSQL-backed, no external search engine                                                 |
| `StatsService`     | Dashboard statistics from metadata only (no Telegram round-trips); category breakdown and largest files                                                                |
| `TrashService`     | Trash listing, "empty trash" (remote-first permanent removal with failure reporting)                                                                                   |
| `IntegrityService` | Read-only drift detection for current objects and historical versions (`missing`, `size_mismatch`, `hash_mismatch`, `unreadable`); streams in deep mode; never repairs |
| `RecentService`    | Most-recently-touched active files, deduplicated from a bounded activity window                                                                                        |
| `ActivityService`  | Best-effort event recording (never throws), credential-key sanitization, retention pruning (90 days)                                                                   |

Shared helper: `query-resolver.ts` turns the user-facing `ListQuery` into the
repository-ready `ItemQuery` — validating sort/date bounds, expanding MIME
categories, and resolving `folder:Name` filters to concrete folder ids.

### Repository interfaces

`packages/core/src/repos.ts` defines `Repo` with `users`, `sessions`,
`storages`, `folders`, `files` and `activity`. Each interface exposes only
domain operations, not query builders:

- `UserRepository` — `findById`, `findByTelegramId`, `upsertFromTelegram`
- `SessionRepository` — `get`, `save`, `delete`
- `StorageRepository` — `findByUserAndProvider`, `create`
- `FolderRepository` — CRUD plus `listByUser`, `listChildren`, `query`,
  `findIdsByName`, `updateMany`, `deleteMany`, `countByUser`
- `FileRepository` — CRUD plus `listByFolder`, `listByUser`, `listByIds`,
  `query`, `updateMany`, `statsByUser`, `deleteMany`, and the version methods
  (`createVersion`, `listVersions`, `findVersionById`, `countVersions`,
  `deleteVersionsByFileIds`)
- `ActivityRepository` — `record`, `list`, `recentFiles`, `countByUser`,
  `pruneOlderThan`

The Prisma layer (`createPrismaRepos`) maps database rows onto the domain
records in `packages/core/src/types.ts` and converts `BigInt` columns to
`number`/`string` as appropriate.

## Request lifecycle

```text
HTTP request
  │
  ├─ onRequest  : resolve/attach request id (x-request-id)
  │               apply SECURITY_HEADERS
  ├─ preHandler : state-changing? verify Origin against ALLOWED_ORIGINS / Host
  ├─ preHandler : auth hook — /api/* (except /api/auth/*, /api/health*)
  │               verifies the session cookie, loads the user, sets request.user
  ├─ route      : parse/validate inputs (validation.ts), map params
  ├─ service    : apply domain rules and ownership checks
  ├─ repo       : PostgreSQL via Prisma
  ├─ provider   : (only when bytes are involved) StorageEngine → StorageProvider
  │               → TelegramStorageProvider → MTProto
  ├─ activity   : record an ActivityEvent (best effort)
  └─ response   : DTO mapped in mappers.ts
     │
     └─ on error : DomainError → { error: { code, message, requestId, details? } }
                   anything else → 500 INTERNAL_ERROR (logged with the request id)
```

For file bytes the sequence is upload-then-metadata (see the reliability rules
below). Downloads stream from Telegram and verify SHA-256 before the final bytes
are released, so a corrupt object fails the transfer instead of completing.

## Reliability rules (v0.2)

These are the invariants that make a Telegram-backed drive trustworthy. Each is
enforced in code; where the rule is violated by a failure, the failure is
reported rather than hidden.

1. **Metadata only after storage success.** `FileService.upload` calls the
   engine first and writes a `File` row only after `put` returns. The database
   never advertises a file whose bytes were not stored.
2. **Remote-object-first permanent delete.** `FileService.deletePermanently`,
   `FolderService.deletePermanently` and `TrashService.empty` remove the Telegram
   message for the current object **and every historical version** before any
   metadata is deleted. If any remote delete fails, the operation fails and all
   version and file rows are **kept**, so a retry can finish without orphaning a
   storage object. Missing objects are treated as already removed.
3. **Never trust client ownership.** Every service method takes the server-derived
   `userId` and re-checks `record.userId`. Foreign records answer as `404`, not
   `403`, to avoid leaking existence.
4. **Sessions never leave the server.** The MTProto session string is stored in
   PostgreSQL, never logged and never included in a response or activity event.
5. **No silent repair.** `IntegrityService` only reports; it does not delete,
   rewrite or re-upload. Repairs are an explicit, separate action.
6. **Deterministic states.** Trash is a soft-delete marker with an opaque
   `trashBatchId`; restore is exact. Restoring a file whose folder is gone
   falls back to the root. Moving a folder into its own subtree is rejected.
   States are always derivable from the database alone.
7. **Observable failures.** Domain errors carry stable codes, HTTP statuses and
   request ids; batch operations report per-item failures; `failedFiles` in
   empty-trash surfaces what could not be removed.

Wrapping all provider traffic is the `StorageEngine`, which adds SHA-256
computation, bounded retries with exponential backoff (`DEFAULT_RETRY_POLICY` =
3 attempts, 400 ms base), progress callbacks and cancellation. Transient
transport failures retry; authentication, validation, cancellation and
`FLOOD_WAIT` errors do not. Details in
[storage-provider.md](./storage-provider.md).

## Monorepo layout

```text
OmniCloud/
├── apps/
│   ├── api/                 Fastify HTTP server (routes, auth, container, config)
│   └── web/                 React SPA
├── packages/
│   ├── shared/              DTOs, ERROR_CODES, query language, MIME helpers
│   ├── core/                Domain types, repos, errors, StorageEngine, services
│   ├── database/            Prisma schema, migrations, repository implementations
│   ├── telegram/            MTProto client manager, connection flow, provider
│   └── sdk/                 @lacrous/omnicloud client + re-exports
├── docs/                    This documentation
├── docker-compose.yml       Development PostgreSQL
└── pnpm-workspace.yaml      apps/*, packages/*
```

Package import direction: `shared` ← `core` ← (`database`, `telegram`) ←
`api`; `sdk` re-exports from `core`, `telegram` and `shared`. `shared` has no
workspace dependencies, which is what lets the web app and SDK reuse DTOs and
the query parser without pulling in server code.

## Known v0.2 constraints

- Single process: rate limiting is in-memory and there is one MTProto
  connection per user per process. Horizontal scaling is out of scope.
- Uploads and downloads are materialized in memory; `MAX_UPLOAD_MB`
  (default 256) bounds uploads. The provider cap is Telegram's 2 GB document
  limit.
- Search is PostgreSQL `ILIKE`/prefix based — no full-text or content search,
  no Elasticsearch.
- Version history is recorded but there is no version restore/delete UI yet
  (planned for v0.3).
- Providers other than Telegram (S3, WebDAV, local disk) are not implemented.
