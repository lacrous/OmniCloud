# Architecture

OmniCloud turns a user's own Telegram account into the object store for a
self-hosted cloud drive. PostgreSQL holds the entire logical structure:
users, folders, files, versions, trash state, stars, activity, sessions and API
tokens. Telegram holds only file bytes.

This document explains how the pieces fit together: the layering, the request
lifecycle, the upload and download pipelines, the storage abstraction, the
transaction boundaries, the session model, the activity log, and the two
read-only services that compare the database with the channel.

## Contents

- [Layers](#layers)
- [Why core never imports Prisma or Telegram](#why-core-never-imports-prisma-or-telegram)
- [What PostgreSQL owns and what Telegram owns](#what-postgresql-owns-and-what-telegram-owns)
- [Data model](#data-model)
- [Request lifecycle](#request-lifecycle)
- [Upload pipeline](#upload-pipeline)
- [Download pipeline](#download-pipeline)
- [The StorageEngine abstraction](#the-storageengine-abstraction)
- [Transaction boundaries](#transaction-boundaries)
- [Sessions and tokens](#sessions-and-tokens)
- [Activity log](#activity-log)
- [Integrity and reconciliation](#integrity-and-reconciliation)
- [Service map](#service-map)
- [Reliability rules](#reliability-rules)
- [Monorepo layout](#monorepo-layout)
- [Known constraints](#known-constraints)

## Layers

```text
┌──────────────────────────────────────────────┐
│ Web app (apps/web, React + Vite)            │  React SPA
│ depends on: shared, crypto                   │
└──────────────────────┬───────────────────────┘
                       │ HTTP (cookie session or bearer token,
                       │       JSON, multipart)
┌──────────────────────▼───────────────────────┐
│ API (apps/api, Fastify)                      │  routing, validation,
│  routes → auth hook → error handler          │  DTO mapping
│  depends on: core, database, telegram, shared│
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│ Core services (packages/core)                │  domain logic
│  FileService FolderService TrashService      │
│  SearchService StatsService RecentService    │
│  ActivityService IntegrityService            │
│  ReconciliationService ReconciliationFlow    │
│  depends on: shared                          │
└───────┬──────────────────────────┬───────────┘
        │ repository interfaces     │ StorageEngine / StorageProvider
┌───────▼─────────┐      ┌─────────▼───────────┐
│ packages/       │      │ packages/telegram    │
│ database        │      │ TelegramStorageProvider
│ (Prisma)        │      │ + MTProto connection │
└───────┬─────────┘      └─────────┬───────────┘
        │                          │ MTProto (GramJS)
┌───────▼─────────┐    ┌─────────▼─────────────┐
│ PostgreSQL      │    │ Private Telegram       │
│ (metadata)      │    │ channel "OmniCloud     │
│                 │    │ Storage" (file bytes)  │
└─────────────────┘    └────────────────────────┘
```

The import direction is one-way:

```text
shared ← core ← (database, telegram) ← api
   ↑        ↑          ↑                ↑
   └────────┴──────────┴────────────────┘
            sdk  (re-exports core, telegram, shared and crypto;
                  it does not import the API)
```

| Package             | Workspace dependencies                   | Owns                                                              |
| ------------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| `packages/shared`   | none                                     | DTOs, error codes, the query and search parsers, MIME helpers     |
| `packages/crypto`   | none                                     | The OCE1/OCE2 client-side encryption protocol                     |
| `packages/core`     | `shared`                                 | Domain types, repository interfaces, domain errors, services      |
| `packages/database` | `core`                                   | The Prisma schema, migrations and the repository implementations  |
| `packages/telegram` | `core`                                   | The GramJS client manager, the connection flow, the provider      |
| `apps/api`          | `core`, `database`, `telegram`, `shared` | The HTTP server and the dependency-injection container            |
| `apps/web`          | `shared`, `crypto`                       | The React single-page application                                 |
| `packages/sdk`      | `core`, `crypto`, `shared`, `telegram`   | The published `@hilbras/omnicloud` client, CLI and bundled server |

`packages/shared` has no workspace dependencies at all. That is what lets the
web app and the SDK reuse the DTOs and the query parser without pulling in any
server code, and it keeps the browser bundle free of Prisma and MTProto.

## Why core never imports Prisma or Telegram

`packages/core/package.json` lists exactly one dependency: `@omnicloud/shared`.
There is no `@prisma/client` and no `telegram` in the tree, and no source file
under `packages/core/src` imports either.

Two interfaces carry the boundary:

- `packages/core/src/repos.ts` defines the repository contracts (`UserRepository`,
  `SessionRepository`, `StorageRepository`, `FolderRepository`, `FileRepository`,
  `ActivityRepository`, `BrowserSessionRepository`, `ApiTokenRepository`,
  `UploadOperationRepository`). They expose domain operations, never query
  builders.
- `packages/core/src/storage/provider.ts` defines `StorageProvider`, the
  pluggable backend contract, and `StoredRef`, an opaque handle.

The implementations live outside core: `createPrismaRepos` in
`packages/database/src/index.ts` and `TelegramStorageProvider` in
`packages/telegram/src/provider.ts`. The API container
(`apps/api/src/container.ts`) is the only place that wires the two together.

What that buys:

- **Core is testable without infrastructure.** `packages/core/test/fakes.ts`
  provides in-memory repositories and a fake storage provider, so the domain
  tests need neither PostgreSQL nor a Telegram account.
- **A new backend touches no service.** S3, WebDAV or a local disk implement
  `StorageProvider` and are selected by the `Storage.provider` column. The
  services keep talking to `StorageEngine`.
- **Domain errors are defined once.** `packages/core/src/errors.ts` owns the
  error hierarchy and the HTTP status each error maps to. The Telegram package
  maps RPC failures onto it; the API serialises it. Neither re-decides the
  status code.
- **The server is not the only client.** The SDK imports `core` for the domain
  types, so the client and the server speak the same vocabulary.

## What PostgreSQL owns and what Telegram owns

| Concern                              | Owner               | Notes                                                                      |
| ------------------------------------ | ------------------- | -------------------------------------------------------------------------- |
| File bytes                           | Telegram            | One document message per version in the user's private channel             |
| Object reference                     | PostgreSQL          | `File.telegramMessageId` / `FileVersion.telegramMessageId`                 |
| File name, size, MIME type, SHA-256  | PostgreSQL          | `File` / `FileVersion` rows                                                |
| Folder hierarchy                     | PostgreSQL          | Folders are virtual; there is no Telegram counterpart                      |
| Trash state, stars, version pointers | PostgreSQL          | `deletedAt`, `trashBatchId`, `starred`, `currentVersionId`, `versionCount` |
| Telegram session string              | PostgreSQL          | `TelegramSession`, sealed at rest, server-side only                        |
| Storage registration                 | PostgreSQL          | `Storage` (provider, channel id, access hash, title)                       |
| Activity events                      | PostgreSQL          | `ActivityEvent`                                                            |
| Browser session                      | Opaque token cookie | A `BrowserSession` row; only the token's SHA-256 is stored                 |
| API token                            | Bearer secret       | An `ApiToken` row; only the secret's SHA-256 is stored                     |

The operational consequence: **PostgreSQL is the only map from file names to
Telegram messages.** Without the database the channel is an unlabelled pile of
messages — for an OCE1-encrypted file, unreadable bytes. Without the channel
the database is a catalog of missing objects. Every mechanism in this document
exists to keep those two halves consistent.

## Data model

Defined in `packages/database/prisma/schema.prisma`.

### `User`

The Telegram identity mapped to an OmniCloud account. `telegramUserId` is
`BigInt` and unique; Telegram identifiers exceed JavaScript's safe-integer
range and are converted to strings at the repository boundary.

Key fields: `id`, `telegramUserId` (unique), `username`, `firstName`,
`lastName`, `phone`, `recoveryBlob`, `createdAt`, `updatedAt`.

`recoveryBlob` holds the opaque OCE1 recovery blob. The server stores
ciphertext it cannot open without the user's recovery code.

### `TelegramSession`

The MTProto session string for the user's connected Telegram account.

Key fields: `userId` (unique, cascade delete), `stringSession`.

MTProto sessions must survive process restarts so storage reconnects lazily.
The value is never exposed through the API and never logged. See
[Sessions and tokens](#sessions-and-tokens) for how it is sealed at rest.

### `Storage`

The user's private storage channel used as the backing object store.

Key fields: `userId`, `provider` (default `"telegram"`), `title`,
`telegramChatId` (`BigInt`), `telegramAccessHash` (`BigInt`), unique
`(userId, provider)`.

Every provider call builds an explicit `InputPeerChannel` from the raw id and
the access hash, so entity resolution never depends on client-side caches.

### `Folder`

A virtual hierarchy node. `deletedAt` is the Trash marker.

Key fields: `userId`, `parentId` (self-relation, `onDelete: Restrict`), `name`,
`starred`, `deletedAt`, `trashBatchId`, `createdAt`, `updatedAt`.

`trashBatchId` groups everything one trash operation moved, so restoring a
folder restores exactly the subtree that was trashed with it and leaves
separately-trashed items alone. Timestamp equality is fragile; a shared opaque
batch id is exact. It is `null` for a row that was never trashed, and a file
trashed on its own gets `solo-<id>`.

Indexes: `(userId, parentId, deletedAt)`, `(parentId)`, `(userId, deletedAt)`,
`(userId, name)`, `(userId, starred)`.

### `File`

Current metadata for a file; points at one Telegram message and one version
row.

Key fields: `userId`, `folderId` (`onDelete: SetNull`), `name`, `size`
(`BigInt`), `mimeType`, `sha256`, `telegramMessageId` (`BigInt`),
`encryptionFormat`, `wrappedKey`, `metadataBlob`, `keyEpoch`, `starred`,
`deletedAt`, `trashBatchId`, `currentVersionId`, `versionCount`, timestamps.

`telegramMessageId` is the live object reference; `currentVersionId` links the
version row the content is served from; `deletedAt`/`trashBatchId` give
lossless trash; `starred` is a first-class column so starred listings are
indexed. The four encryption columns are opaque to the server: it stores them
and never interprets them.

Indexes: `(userId, folderId, deletedAt)`, `(folderId)`, `(userId, deletedAt)`,
`(userId, name)`, `(userId, starred)`, `(userId, size)`, `(userId, mimeType)`.

### `FileVersion`

One historical revision of a file. Every upload creates version 1; replacing a
file appends a version and repoints the file.

Key fields: `fileId`, `userId`, `versionNumber`, `size`, `mimeType`, `sha256`,
`telegramMessageId`, the four encryption columns, `createdAt`, unique
`(fileId, versionNumber)`.

Each version holds its own `telegramMessageId`, so older versions remain
independently retrievable and are cleaned up on permanent delete. The version
number is one past the highest existing number, not the row count, because
pruning removes rows from the middle.

### `ActivityEvent`

Structured audit and observability events.

Key fields: `userId`, `action`, `resourceType`, `resourceId`, `resourceName`,
`metadata` (`Json?`), `createdAt`.

Indexes: `(userId, createdAt)`, `(userId, resourceId, createdAt)`,
`(createdAt)`.

### `BrowserSession`, `ApiToken`, `UploadOperation`

- `BrowserSession`: `tokenHash` (unique), `expiresAt`, `revokedAt`,
  `lastUsedAt`, `userAgent`, `ip`.
- `ApiToken`: `name`, `tokenHash` (unique), `revokedAt`, `lastUsedAt`.
- `UploadOperation`: the durable record of one logical upload.
  `operationId` is unique per `(userId, operationId)`; `status`,
  `telegramMessageId`, `sha256`, `size`, `requestFingerprint` and `fileId` make
  a retry resumable instead of a second copy.

## Request lifecycle

```text
HTTP request
  │
  ├─ onRequest  : resolve the request id (inbound x-request-id, else a UUID)
  │               echo it on the response, apply SECURITY_HEADERS
  ├─ preHandler : CSRF origin check on POST/PUT/PATCH/DELETE
  ├─ preHandler : auth hook — every /api route except /api/auth/*,
  │               /api/health* and /api/update/*
  │               Authorization: Bearer → API token, else the session cookie
  │               → request.user = { id } (server-derived)
  ├─ route      : parse and validate (validation.ts), map params
  ├─ service    : apply domain rules and ownership checks
  ├─ repo       : PostgreSQL via Prisma
  ├─ provider   : only when bytes are involved —
  │               StorageEngine → StorageProvider → MTProto
  ├─ activity   : record an ActivityEvent (best effort)
  └─ response   : DTO mapped in mappers.ts
     │
     └─ on error : DomainError → { error: { code, message, requestId, details? } }
                   FST_*_TOO_LARGE → 413 PAYLOAD_TOO_LARGE
                   anything else → 500 INTERNAL_ERROR, logged with the request id
```

Points worth knowing:

- **The request id is the correlation key.** It comes from the inbound
  `x-request-id` header when it is present and short enough, otherwise a UUID
  is generated. The same id appears in the response header, in every log line
  and in every error body.
- **The origin check is defence in depth.** `SameSite=Lax` cookies already
  stop cross-site form posts; the check rejects a cross-origin
  `POST`/`PUT`/`PATCH`/`DELETE` outright. A request with no `Origin` header is
  a non-browser client and is allowed through.
- **The user id is server-derived.** The auth hook resolves it from the
  session or the API token. Services take that id as an argument and re-check
  `record.userId`; a record owned by someone else answers as `404`, not `403`.
- **Activity recording never fails the request.** A logging error is swallowed.

## Upload pipeline

```text
POST /api/files            (multipart: file, folderId?, operationId?)
  │
  ├─ @fastify/multipart   : 1 file, 10 parts, fileSize ≤ MAX_UPLOAD_MB
  ├─ spoolToFile(part.file, maxUploadBytes)
  │     writes to a temp directory while hashing,
  │     enforcing the cap as it writes
  │     → { path, size, sha256 }
  │
  ├─ FileService.upload(userId, { name, folderId, spooled, operationId })
  │     ├─ sanitizeFileName, mimeFromFilename
  │     ├─ (idempotent path) claim the UploadOperation
  │     ├─ StorageEngine.upload
  │     │     └─ TelegramStorageProvider.put
  │     │           forceDocument: true → one document message
  │     │           assertStoredSize(stored.size === size)
  │     ├─ commitRecord → File + FileVersion in one transaction
  │     └─ activity: "upload"
  │
  └─ 201 { file: FileDTO }
```

### Why the order matters

1. **Hash while spooling, before the upload.** The checksum in the database
   describes the bytes that were actually sent, because it was computed from
   the same stream that was written to disk. Hashing afterwards would mean
   hashing a second copy of the file.
2. **Spool before the upload.** The multipart body is written to a temporary
   file rather than held in memory, so live memory does not grow with the file
   size. Telegram reads the parts it needs from disk. The spool is removed on
   success, on failure and on rejection; a spool left by a killed process is
   removed at the next start (`sweepStaleSpools`).
3. **Upload before commit.** The database never advertises a file whose bytes
   were not stored. The reverse order would leave a `File` row pointing at a
   message id that does not exist, and no later scan would be able to tell a
   missing object from a lost upload.
4. **Verify the size after the upload, before the commit.**
   `StorageEngine.assertStoredSize` compares the size Telegram reports with the
   size that was spooled. A mismatch means the object in the channel is not the
   object that was hashed, so both the checksum and the recorded size would be
   wrong. The upload fails and nothing is committed.
5. **Commit the file and its first version together.** One transaction writes
   the `File` row, the `FileVersion` row and the `currentVersionId` pointer, so
   a failure cannot leave a file row without a version.
6. **Clean up after a failed commit.** If the commit fails after Telegram
   accepted the object, the object is deleted so no unreferenced message is
   left behind. If that deletion also fails, the leftover is written to the
   activity log with its message id (`metadata.orphanedObject`) so it can be
   found and removed later. The original commit error is still reported.

### Idempotent uploads

A client-supplied `operationId` (the `Idempotency-Key` header or an
`operationId` field) makes a retried upload resumable. The `UploadOperation`
row is the state machine:

| Status       | Meaning                                                                       |
| ------------ | ----------------------------------------------------------------------------- |
| `PENDING`    | Accepted; the Telegram write has not started                                  |
| `UPLOADING`  | The write is in flight, or its outcome is unknown                             |
| `COMMITTING` | Exactly one request holds the claim and turns the stored object into a record |
| `COMPLETED`  | The object is stored and the file record is committed; the result is final    |
| `UNKNOWN`    | The write may have stored the object; the outcome is not known                |
| `FAILED`     | The write definitively failed; the operation may be retried                   |

Only a request that wins the compare-and-set claim uploads. `UNKNOWN` is
resolved, never blindly re-sent: the channel is searched for the caption
`<sha256>:<operationId>` and the size. Exactly one match is adopted, no match
means nothing was stored so the upload is sent again, and anything ambiguous
stays `UNKNOWN` without a write. The caption carries the operation id, so two
uploads of identical bytes never match each other.

## Download pipeline

```text
GET /api/files/:id/download
  │
  ├─ FileService.downloadStreamed
  │     └─ getActive — a trashed file answers 404
  ├─ StorageEngine.downloadStream(ref, record.sha256)
  │     ├─ provider.getStream → Telegram document chunks
  │     │     (512 KiB per upload.getFile request)
  │     └─ a Transform gate: hash every chunk, hold the last one back
  ├─ reply headers
  │     Content-Type, Content-Length,
  │     X-Content-SHA256, Content-Disposition
  └─ the final chunk is pushed only after the digest matches
```

### The checksum check

The engine hashes every chunk as it flows, including the last one, and holds
that last chunk back until the digest of the whole object has been compared
with the stored SHA-256. A mismatch raises `IntegrityCheckError` (502
`INTEGRITY_CHECK_FAILED`) and the last bytes are never released. A consumer
therefore never sees a complete-looking body that fails the checksum: a
corrupt object ends the response with a broken connection instead of
completing with bad data.

Two consequences worth knowing:

- **The check needs the whole object.** A consumer that stops reading early
  gets no error and has seen unverified bytes. Read the stream to the end to
  have the checksum enforced. Callers that also know the expected length can
  detect an early stop themselves; the SDK does this from the response's
  `Content-Length` and raises `DOWNLOAD_INCOMPLETE`.
- **The buffered path returns a boolean.** `FileService.download` computes the
  digest of the whole buffer and returns `integrityVerified`. The HTTP
  download endpoint uses the streaming path, so there is no
  `X-Integrity-Verified` header — it cannot be known before the body is sent.
  The stored checksum is published as `X-Content-SHA256` instead.

## The StorageEngine abstraction

Two layers, both in `packages/core/src/storage/`:

```text
service → StorageEngine → StorageProvider → (TelegramStorageProvider → MTProto)
```

`StorageProvider` is the backend contract: `put`, `get`, `getStream`,
`delete`, `exists`, `stat`, `listObjects`, an optional `findByCaption`, and
`healthCheck`. `StoredRef` is opaque to callers — for Telegram it is the
message id of the document message, for another provider it would be a key.

`StorageEngine` sits between the services and the raw provider and adds the
guarantees every backend shares:

| Concern        | What the engine does                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| SHA-256        | Computes it on upload; verifies it on download                                                                                     |
| Size assertion | `assertStoredSize` compares the stored size with the size that was sent                                                            |
| Retries        | Bounded, with exponential backoff                                                                                                  |
| Progress       | `{ transferred, total, percent }` callbacks                                                                                        |
| Cancellation   | An `AbortSignal` aborts the transfer and is never retried                                                                          |
| Error mapping  | Non-domain failures become `UploadFailedError` (502) with the original error in `details`; a domain error passes through untouched |
| Streaming gate | Holds the last chunk back until the digest matches                                                                                 |

The retry policy is `DEFAULT_RETRY_POLICY = { attempts: 3, baseDelayMs: 400 }`.
`retryDelayMs` honours a provider-supplied `retryAfterSeconds` exactly;
otherwise it uses exponential backoff with full jitter, capped at
`baseDelayMs * 2^(attempt-1)`. `isRetryableError` reads the error's declared
contract (`DomainError.retryable`), never its message text. Cancellation is
never retried.

The engine is resolved per user. `EngineResolver` looks up the `Storage` row
for `(userId, "telegram")`, asks the client manager for a connected client,
and builds `new StorageEngine(new TelegramStorageProvider(client, { chatId,
accessHash, title }))`. The container caches one engine per user.

The full provider contract is in [storage-provider.md](./storage-provider.md);
the Telegram implementation is in [telegram.md](./telegram.md).

## Transaction boundaries

Telegram and PostgreSQL cannot share a transaction. That single fact decides
where each transaction starts and stops.

### Inside a database transaction

| Operation                            | Isolation                      | What moves together                                                                                                                  |
| ------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Create a file with its first version | default                        | `File` row, `FileVersion` row, `currentVersionId`, `versionCount`                                                                    |
| Replace a file with a new version    | serializable, retried on P2034 | The new `FileVersion` row and the file's pointer, size, checksum, message id and encryption fields                                   |
| Create a version                     | serializable, retried on P2034 | The version number is read and allocated in the same transaction, so two concurrent replacements cannot collide                      |
| Delete one version                   | serializable                   | The version row and the file's `versionCount`; the repository refuses to delete the version a file points at                         |
| Move a folder                        | serializable                   | The ancestor chain is re-checked inside the transaction, so a concurrent move cannot slip a cycle in between the check and the write |
| Trash a folder subtree               | default                        | Every folder and file in the subtree gets the same `deletedAt` and `trashBatchId`                                                    |
| Restore a folder subtree             | default                        | The folders, the files and the reparent move together                                                                                |

`UploadOperation.claim` is an atomic compare-and-set rather than a
transaction: a single `UPDATE ... WHERE status = <from>` whose row count
decides the winner. Exactly one request can move an operation from `PENDING`
to `UPLOADING`, or from `UPLOADING` to `COMMITTING`.

### Deliberately outside a transaction

| Step                                     | Why                                                                                                                                                                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Telegram write (upload, delete)      | Holding a database transaction open across a network round-trip to Telegram would pin a connection for the length of the transfer. The write happens first and the metadata follows.                                  |
| Remote deletes before a permanent delete | The Telegram messages for the current object and every historical version are removed first. If any remote delete fails the operation fails and all rows are kept, so a retry can finish without orphaning an object. |
| Activity logging                         | `ActivityService.record` writes on its own and never throws. A logging failure must not fail the operation that produced it.                                                                                          |
| Health, statistics and listing reads     | Nothing to make atomic. The statistics service deliberately never touches Telegram, and a reconciliation scan only reads the channel.                                                                                 |

The pattern that runs through all of it: **the remote write is committed
before the local write is acknowledged, and a failure between the two is
recoverable rather than silent.** A failed commit removes the object it had
just stored; a failed remote delete keeps the rows so the operation can be
retried.

## Sessions and tokens

Three unrelated secrets, three different lifetimes, three different places to
revoke them.

| Secret                          | Client holds               | Server stores                           | Lifetime                                | Revocation                                                 |
| ------------------------------- | -------------------------- | --------------------------------------- | --------------------------------------- | ---------------------------------------------------------- |
| Browser session cookie          | `omnicloud_session` cookie | `BrowserSession.tokenHash` (SHA-256)    | 30 days                                 | Delete or revoke the row; takes effect on the next request |
| Personal API token              | The secret, once           | `ApiToken.tokenHash` (SHA-256)          | Until revoked                           | `revokedAt`; takes effect on the next use                  |
| Telegram MTProto session string | Nothing — server-side only | `TelegramSession.stringSession`, sealed | Until the device is revoked in Telegram | Telegram → Settings → Devices                              |

### Browser sessions

`AuthSessionService` issues 32 random bytes, base64url-encoded, as the cookie
value. Only the SHA-256 of the token is stored, so a database read does not
yield a usable cookie. `resolve()` returns `null` for an unknown, expired or
revoked token and refreshes `lastUsedAt` on every success.

The cookie is set with `httpOnly`, `sameSite: "lax"`, `path: "/"`, and
`secure` when `COOKIE_SECURE=true`.

`POST /api/auth/logout` revokes the session behind the cookie and drops the
in-memory Telegram connection. `POST /api/auth/logout-all` revokes every
browser session for the account and reports how many were revoked.

Expired sessions are pruned hourly by the API process, with a seven-day grace
period.

### API tokens

`ApiTokenService` issues 32 random bytes as the secret and shows it once, at
creation. Only the SHA-256 is stored. A bearer token is sent as
`Authorization: Bearer <token>`; the auth hook resolves it before it looks at
the cookie, and a bearer header that does not resolve is rejected outright
rather than falling back to the cookie, so a revoked or mistyped token fails
loudly.

### The Telegram session string

The MTProto session string grants full access to the user's Telegram account,
so it is the most sensitive value in the system.

- **Sealed at rest.** `SecretBox` seals it with **AES-256-GCM** and a fresh
  random 96-bit IV per seal. The stored envelope is
  `v<keyVersion>:<iv>:<tag>:<ciphertext>` in base64url, so a key can be
  rotated later by keeping older key versions available for decryption.
- **The key comes from `OMNICLOUD_ENCRYPTION_KEY`.** A 64-character hex string
  is used as-is (`openssl rand -hex 32`); anything else must be at least 32
  characters and is stretched with scrypt against a fixed salt.
- **Required in production.** `loadConfig` throws when `NODE_ENV=production`
  and the key is missing. Without a key, sessions are stored unsealed, which
  the readiness probe reports.
- **Legacy sessions are re-sealed on read.** A stored value without the
  `v<version>:` prefix is a plaintext session from before encryption was
  enabled. It is returned, then written back sealed, so the upgrade leaves no
  plaintext behind.
- **Never leaves the server.** It is not in an API response, a DTO, activity
  metadata or a log line. Only `TelegramClientManager` receives it.
- **Logout does not revoke it on Telegram's side.** Sign-out drops the
  in-memory connection and revokes the browser session; the MTProto session
  stays valid until the user removes the device in Telegram's settings.

Losing `OMNICLOUD_ENCRYPTION_KEY` makes every stored session unreadable. Users
then sign in again.

## Activity log

`ActivityService` records a structured event for every meaningful operation:
`upload`, `replace`, `download`, `open`, `rename`, `move`, `trash`, `restore`,
`delete`, `delete_version`, `restore_version`, `create_folder`, `star`,
`unstar`, plus `other` for a stored action this version does not recognise.

Three properties make the log safe to keep:

- **Recording never throws.** A logging failure must not fail the operation
  that produced it, so errors are swallowed. `ActivityService` is injected
  behind the narrow `ActivityRecorder` interface, so a no-op recorder can be
  substituted where logging is not wanted.
- **Metadata is sanitized.** `sanitizeMetadata` drops any key matching
  `/(password|secret|token|session|hash|credential)/i`, so the log cannot
  become a place where secrets leak.
- **The log is also a repair channel.** When a commit fails and the cleanup
  delete fails as well, the orphaned object is written to the log with its
  message id (`metadata.orphanedObject`, `metadata.messageId`,
  `metadata.cleanupError`) so it can be found and removed later. Nothing is
  silently discarded.

Retention pruning exists as `ActivityService.prune()`, which deletes events
older than 90 days. **Nothing schedules it today** — it is called explicitly by
an operator or a test. The `createdAt` index on `ActivityEvent` supports it.

`RecentService` reads the log to build the Recent view: it pulls a bounded
window of meaningful actions (`upload`, `download`, `open`, `rename`, `move`,
`replace`), deduplicates by file, and drops files that are trashed or gone, so
the view never surfaces an item the user cannot open.

## Integrity and reconciliation

Two separate read-only services answer two different questions.

|          | `IntegrityService`                                        | `ReconciliationService`                               |
| -------- | --------------------------------------------------------- | ----------------------------------------------------- |
| Question | Do the records match the bytes?                           | Do the channel contents match the records?            |
| Reads    | `stat` per object; a streamed re-hash in deep mode        | A listing of the user's channel                       |
| Scope    | The user's active files and their historical versions     | The user's channel contents vs. the user's references |
| Findings | `missing`, `size_mismatch`, `hash_mismatch`, `unreadable` | `unknown`, `dangling`                                 |
| Writes   | None                                                      | None                                                  |

### Integrity check

`POST /api/storage/integrity/check` with `{ "deep": false }` calls `stat` on
the current object of every active file and on every historical version. A
missing message is `missing`; a size that differs from the metadata is
`size_mismatch`; a provider error is `unreadable`. With `{ "deep": true }` each
object is additionally streamed and re-hashed, and a digest that does not match
is `hash_mismatch`. Deep mode never holds the object in memory.

Issues against a historical version carry a `versionId`, so a missing old
version is reported against that version rather than hidden behind the current
file.

The checker never deletes, rewrites or re-uploads anything.

### Reconciliation

`POST /api/storage/reconciliation` lists the user's channel and compares it
with the user's references:

- `unknown` — a message exists in the channel that no file, version or
  in-flight upload references. It may be a leaked upload, or something the user
  stored themselves. It is reported and never removed.
- `dangling` — a record points at a message that is no longer in the channel.

Two details keep the report honest:

- **In-flight uploads count as referenced.** Message ids held by
  `UploadOperation` rows in `PENDING`, `UPLOADING`, `UNKNOWN` or `COMMITTING`
  are protected, so a live upload is never reported as an orphan.
- **A partial scan says so.** The scan reads at most 5000 channel messages
  per request. When the cap is reached the report sets `truncated: true`, so a
  caller never mistakes a partial scan for a full one.

### Repair

Repair is two explicit steps, and neither deletes anything from the channel.

1. `POST /api/storage/reconciliation/plan` reruns the scan and returns the
   actions that could be approved, each with an id and a reason. It changes
   nothing.
2. `POST /api/storage/reconciliation/apply` takes
   `{ "approvedIds": [...] }`, reruns the scan, and applies only the ids the
   fresh plan still offers. An id the plan does not offer is refused with
   `400 INVALID_REQUEST`; an empty list applies nothing.

| Action            | What it does                                                                                                          | Destructive |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- | ----------- |
| `detach-dangling` | Marks a record whose message is gone by moving it to the Trash                                                        | No          |
| `adopt-unknown`   | Creates a file record for a channel message that has none, using the object's real SHA-256 read from the stored bytes | No          |

`RepairPlan.deletions` is always empty. A channel message is never deleted:
it may be something the user stored themselves, and OmniCloud cannot prove it
owns it.

## Service map

All services live in `packages/core/src/services/` and are instantiated once
per process by the API container (`apps/api/src/container.ts`).

| Service                 | Responsibility                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FileService`           | Upload (with version 1), replace, list/query, get, download + integrity check, rename, star, move, trash, restore, permanent delete, version restore/delete, prune, batch operations |
| `FolderService`         | Create, list children, query, tree, rename, star, move (cycle-checked), subtree trash/restore (batch semantics), permanent subtree delete, batch                                     |
| `SearchService`         | Parses the query language and evaluates it through the repositories; PostgreSQL-backed, no external search engine                                                                    |
| `StatsService`          | Dashboard statistics from metadata only (no Telegram round-trips); category breakdown and largest files                                                                              |
| `TrashService`          | Trash listing, "empty trash" (remote-first permanent removal with failure reporting), retention purge                                                                                |
| `IntegrityService`      | Read-only drift detection for current objects and historical versions; streams in deep mode; never repairs                                                                           |
| `ReconciliationService` | Read-only comparison of one user's storage channel with their records; never deletes or repairs                                                                                      |
| `ReconciliationFlow`    | The two explicit repair steps: plan, then apply the approved ids                                                                                                                     |
| `RecentService`         | Most-recently-touched active files, deduplicated from a bounded activity window                                                                                                      |
| `ActivityService`       | Best-effort event recording (never throws), credential-key sanitization, retention pruning on demand                                                                                 |
| `AuthSessionService`    | Browser session issue, resolve, revoke, revoke-all, prune                                                                                                                            |
| `ApiTokenService`       | Personal API token issue, resolve, revoke                                                                                                                                            |

Shared helpers: `query-resolver.ts` turns the user-facing `ListQuery` into the
repository-ready `ItemQuery` — validating sort and date bounds, expanding MIME
categories, and resolving `folder:Name` filters to concrete folder ids.
`version-retention.ts` decides which historical versions a policy would remove,
and nothing else.

## Reliability rules

These are the invariants that make a Telegram-backed drive trustworthy. Each is
enforced in code; where a rule is violated by a failure, the failure is
reported rather than hidden.

1. **Metadata only after storage success.** `FileService.upload` calls the
   engine first and writes a `File` row only after `put` returns. The database
   never advertises a file whose bytes were not stored.
2. **Remote-object-first permanent delete.** `FileService.deletePermanently`,
   `FolderService.deletePermanently` and `TrashService.empty` remove the
   Telegram message for the current object **and every historical version**
   before any metadata is deleted. If any remote delete fails, the operation
   fails and all version and file rows are **kept**, so a retry can finish
   without orphaning a storage object. Missing objects are treated as already
   removed.
3. **Never trust client ownership.** Every service method takes the
   server-derived `userId` and re-checks `record.userId`. Foreign records
   answer as `404`, not `403`, to avoid leaking existence.
4. **Sessions never leave the server.** The MTProto session string is stored in
   PostgreSQL, never logged and never included in a response or activity event.
5. **No silent repair.** `IntegrityService` and `ReconciliationService` only
   report. Repairs are an explicit, separate, approved action.
6. **Deterministic states.** Trash is a soft-delete marker with an opaque
   `trashBatchId`; restore is exact. Restoring a file whose folder is gone
   falls back to the root. Moving a folder into its own subtree is rejected.
   States are always derivable from the database alone.
7. **Observable failures.** Domain errors carry stable codes, HTTP statuses and
   request ids; batch operations report per-item failures; `failedFiles` in
   empty-trash surfaces what could not be removed.

## Monorepo layout

```text
OmniCloud/
├── apps/
│   ├── api/                 Fastify HTTP server (routes, auth, container, config)
│   └── web/                 React SPA
├── packages/
│   ├── shared/              DTOs, ERROR_CODES, query language, MIME helpers
│   ├── crypto/              The OCE1/OCE2 client-side encryption protocol
│   ├── core/                Domain types, repos, errors, StorageEngine, services
│   ├── database/            Prisma schema, migrations, repository implementations
│   ├── telegram/            MTProto client manager, connection flow, provider
│   └── sdk/                 @hilbras/omnicloud client + CLI + bundled server
├── docs/                    This documentation
├── docker-compose.yml       Development PostgreSQL
└── pnpm-workspace.yaml      apps/*, packages/*
```

## Known constraints

See [limitations.md](./limitations.md) for the full list, and
[storage.md](./storage.md) for the upload, download, version and trash
lifecycle in detail.
