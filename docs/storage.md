# Storage lifecycle

This document follows a file through OmniCloud: how it is uploaded and stored,
how it is downloaded and verified, how versions are created, replaced,
restored, pruned and deleted, how long the Trash keeps things, and how the two
read-only services compare the database with the channel.

```text
Telegram = physical storage
PostgreSQL = cloud metadata
OmniCloud = the storage layer between them
```

The application never talks to Telegram directly. Every byte of content flows
through the `StorageProvider` abstraction
(`packages/core/src/storage/provider.ts`), wrapped by the `StorageEngine`
(`packages/core/src/storage/engine.ts`). The provider contract is documented in
[storage-provider.md](./storage-provider.md); the Telegram implementation is in
[telegram.md](./telegram.md).

## Contents

- [What lives where](#what-lives-where)
- [Upload](#upload)
- [Download](#download)
- [Versions](#versions)
- [The version lifecycle](#the-version-lifecycle)
- [Trash and retention](#trash-and-retention)
- [Integrity checks](#integrity-checks)
- [Reconciliation](#reconciliation)
- [Ordering and failure rules](#ordering-and-failure-rules)
- [Known constraints](#known-constraints)

## What lives where

| Concern                         | Storage                                              |
| ------------------------------- | ---------------------------------------------------- |
| File bytes                      | Telegram channel                                     |
| Folder hierarchy                | PostgreSQL only                                      |
| File name, size, MIME, SHA-256  | PostgreSQL                                           |
| Telegram ids (message, channel) | PostgreSQL                                           |
| Telegram session                | PostgreSQL, sealed at rest                           |
| Browser session                 | Opaque token cookie, checked server-side (revocable) |
| API token                       | Bearer secret, checked server-side (revocable)       |
| Stars, trash state, versions    | PostgreSQL                                           |

The database is the only map from file names to Telegram messages. Without the
database the channel is an unlabelled pile of messages; without the channel the
database is a catalog of missing objects.

## Upload

```text
POST /api/files     multipart: file, folderId?, operationId?
  │
  ├─ multipart limits: 1 file, 10 parts, fileSize ≤ MAX_UPLOAD_MB
  ├─ spool to a temporary file, hashing while writing
  │     → { path, size, sha256 }
  ├─ StorageEngine.upload
  │     └─ TelegramStorageProvider.put
  │           forceDocument: true → one document message per file
  │           assertStoredSize: the stored size must equal the spooled size
  ├─ one transaction: File + FileVersion + currentVersionId + versionCount
  └─ 201 { file: FileDTO }
```

What matters:

- **The body is spooled to disk, not held in memory.** Memory use is bounded
  by the stream's chunk size, not by the file size. The spool is removed on
  success, on failure and on rejection. A spool left behind by a killed
  process is removed at the next start (`sweepStaleSpools`).
- **The size cap is enforced while writing**, so an oversized upload is
  rejected without being stored in full.
- **The checksum is computed server-side** from the bytes that were spooled.
  A client-supplied hash is never trusted.
- **The stored size is verified.** If Telegram reports a different size from
  the one that was sent, the upload fails and nothing is committed: the object
  in the channel is not the object that was hashed.
- **The metadata is written only after the upload succeeds.** The database
  never advertises a file whose bytes were not stored.

### Idempotent uploads

A client-supplied `operationId` (the `Idempotency-Key` header or an
`operationId` field) makes a retried upload resumable rather than a second
copy. The `UploadOperation` row records the attempt, and the message caption
is set to `<sha256>:<operationId>` so a later request can find its own object
and nobody else's.

A retry never writes a second Telegram object: a completed operation returns
its file, and an operation whose object was already stored is committed
without uploading again. See
[architecture.md](./architecture.md#idempotent-uploads) for the state machine.

## Download

```text
GET /api/files/:id/download
  │
  ├─ a trashed file answers 404
  ├─ StorageEngine.downloadStream(ref, record.sha256)
  │     ├─ Telegram document chunks, 512 KiB per request
  │     └─ a gate that hashes every chunk and holds the last one back
  ├─ headers: Content-Type, Content-Length,
  │           X-Content-SHA256, Content-Disposition
  └─ the final chunk is pushed only after the digest matches
```

The checksum is verified **as the bytes flow**. The engine hashes every
chunk, holds the last one back, and releases it only once the digest of the
whole object matches the SHA-256 recorded at upload time. A corrupt object
therefore ends the response with a broken connection instead of completing
with bad data.

Two consequences:

- **Read to the end.** The checksum can only be checked once the whole object
  has been read. A consumer that stops early sees unverified bytes and gets
  no error. Callers that know the expected length can detect an early stop
  themselves; the SDK does this from `Content-Length` and raises
  `DOWNLOAD_INCOMPLETE`.
- **There is no `X-Integrity-Verified` header.** It was removed in v0.2.2
  because it cannot be known before the body is sent. The stored checksum is
  published as `X-Content-SHA256` instead.

The buffered path (`FileService.download`) computes the digest of the whole
buffer and returns `integrityVerified` as a boolean.

## Versions

Every upload creates a version row. Replacing a file appends another version
and repoints the file at it. Each version carries its own
`telegramMessageId`, its own size, MIME type and SHA-256, and its own
encryption metadata, so an older version stays independently retrievable.

| Field                           | Meaning                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| `FileVersion.versionNumber`     | 1 for the first version, then one past the highest existing number |
| `FileVersion.telegramMessageId` | The channel message holding that version's bytes                   |
| `File.currentVersionId`         | The version the file currently serves                              |
| `File.versionCount`             | How many versions the file has                                     |

> The version number is one past the highest existing number, not the row
> count. Pruning removes rows from the middle, so a count can repeat a number
> that still exists. The unique `(fileId, versionNumber)` index guards the
> rest, and the number is allocated inside a serializable transaction, so two
> concurrent replacements cannot both claim it.

## The version lifecycle

```text
                    POST /api/files
                          │
                          ▼
              ┌───────────────────────┐
              │  version 1 created    │  File + FileVersion in
              │  file → version 1     │  one transaction
              └───────────┬───────────┘
                          │
                          │ POST /api/files/:id/replace
                          ▼
              ┌───────────────────────┐
              │  version 2 created    │  new row, file repointed,
              │  file → version 2     │  version 1's message stays
              └───────────┬───────────┘
                          │
        ┌─────────────────┼──────────────────┐
        │                 │                  │
   POST .../versions/ POST .../versions/ DELETE .../versions/
   :id/restore        prune              :versionId
        │                 │                  │
        ▼                 ▼                  ▼
  ┌──────────────┐ ┌──────────────┐  ┌──────────────┐
  │ file points  │ │ message      │  │ message      │
  │ back at the  │ │ deleted, then│  │ deleted, then│
  │ older version│ │ the row      │  │ the row      │
  │ nothing re-  │ │ removed      │  │ removed      │
  │ uploaded     │ │              │  │              │
  └──────────────┘ └──────────────┘  └──────────────┘

  Separately: DELETE /api/files/:id removes every message
  (current and historical), then every version row, then
  the file row.
```

### Version actions

| Action             | Endpoint                                          | Effect                                                                               |
| ------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Create             | `POST /api/files`                                 | A new file with version 1                                                            |
| Replace            | `POST /api/files/:id/replace`                     | A new version; the file points at it. The old version's message stays in the channel |
| Restore            | `POST /api/files/:id/versions/:versionId/restore` | The file points back at the version that already exists. Nothing is re-uploaded      |
| Prune              | `POST /api/files/:id/versions/prune`              | Removes the historical versions the named policy selects                             |
| Delete one version | `DELETE /api/files/:id/versions/:versionId`       | Removes one historical version                                                       |
| Delete the file    | `DELETE /api/files/:id`                           | Removes every message (current and historical) and then every row                    |

**Restore points, it does not copy.** The file is pointed back at the existing
version rather than having its content copied into a new one. That is a
requirement, not an optimisation: the OCE1 record authentication binds the
version id, so a copy of an old version's ciphertext under a new id would fail
to authenticate and could never be decrypted. Pointing at the old version
keeps its bytes, its wrapped key and its version id together.

A restore leaves the file's own name alone: a rename is a property of the
file, not of a version. For an encrypted file the restored version's own
metadata blob comes back with it, so the name embedded in that version's
metadata is the one a download will use.

Restoring the version that is already current returns `409 CONFLICT`.

### Pruning

Pruning is an explicit, per-file action. Nothing is pruned unless you ask for
it, and nothing runs on a schedule.

```json
{ "policy": "KEEP_LATEST_N", "count": 2 }
```

| Policy          | Shape       | Effect                                                               |
| --------------- | ----------- | -------------------------------------------------------------------- |
| `KEEP_ALL`      | —           | Removes nothing. This is the default.                                |
| `KEEP_LATEST_N` | `count` ≥ 0 | Keeps the newest `count` historical versions; the rest are removed.  |
| `KEEP_FOR_DAYS` | `days` ≥ 1  | Keeps historical versions newer than `days`; older ones are removed. |

The current version is never a candidate, whatever the policy says. For each
version the policy selects, the Telegram message is deleted **first** and the
row only after that succeeds, the same order as a permanent delete. A failed
remote delete leaves that version in place. The response is `{ "removed": n }`.

### Deleting a version

The current version cannot be deleted: the file would have nothing left to
point at. The error says so. Restore another version first, or delete the
file. The version's channel message is removed before its row, so a failure
leaves the row behind for reconciliation rather than stranding the object.

## Trash and retention

Trash is a soft delete. `deletedAt` marks the row; the Telegram message is
untouched, so a restore is lossless.

```text
trash        → deletedAt = now, trashBatchId = <batch or "solo-<id>">
restore      → deletedAt = null, trashBatchId = null
```

Trashing a **folder** trashes its whole subtree — folders and files — in one
transaction, with one shared `trashBatchId`. Restoring it restores exactly the
nodes that carry that batch id, so anything the user trashed separately stays
in the Trash. (Rows written before the batch marker existed fall back to
timestamp equality.) Restoring a file whose folder is gone falls back to the
root.

### Retention

`TRASH_RETENTION_DAYS` sets how long a trashed file or folder is kept before
it is removed for good. The default is 30 days.

| Variable               | Default | Effect                                                      |
| ---------------------- | ------- | ----------------------------------------------------------- |
| `TRASH_RETENTION_DAYS` | 30      | Days a trashed file or folder is kept before it is removed. |

- **The server purges on a schedule.** The job runs at startup and then every
  six hours. It walks every user and one user's failure never stops the
  others. A purge removes the expired items' channel messages first and then
  their rows, exactly like a manual delete.
- **`GET /api/trash/retention`** reports the configured number of days.
- **`POST /api/trash/purge`** runs the purge for the calling user on demand.
  Items still within their retention period are left alone and counted as
  `skippedFiles`.
- **A folder waits for its contents.** A folder is only removed once nothing
  trashed is left inside it: a file trashed more recently than its folder is
  kept, and the folder waits for it. Folders are processed deepest-first, so a
  parent is only removed once its children are gone.

> **Note:** The configuration loader accepts only a positive integer for
> `TRASH_RETENTION_DAYS` and rejects `0` at startup with
> `TRASH_RETENTION_DAYS must be a positive integer`. The purge code and
> `POST /api/trash/purge` do handle a retention of zero as "keep the trash
> indefinitely", and `.env.example` documents it that way, so the loader and
> the code disagree. Leave the variable unset for the 30-day default.

### Emptying the trash

`POST /api/trash/empty` removes everything in the Trash permanently. It is
remote-first: the channel messages for the current object and every
historical version are removed before any row is dropped. A file whose remote
delete fails keeps its rows and is reported in `failedFiles`, so the operation
can be retried without orphaning a storage object.

## Integrity checks

`POST /api/storage/integrity/check` is a **read-only** drift check between
PostgreSQL and the channel.

```json
{ "deep": false }
```

| Mode          | What it reads                                                                   |
| ------------- | ------------------------------------------------------------------------------- |
| `deep: false` | `stat` per object: does the message exist, and does its size match the metadata |
| `deep: true`  | The above, plus a streamed re-hash of every object                              |

The check covers the current object of every **active** file and every
**historical version**. Deep mode streams the object and discards the bytes,
so it is safe on large libraries; it is slow but authoritative.

| Kind            | Meaning                                                              |
| --------------- | -------------------------------------------------------------------- |
| `missing`       | Metadata exists, the Telegram message is gone                        |
| `size_mismatch` | The stored object's size differs from the metadata                   |
| `hash_mismatch` | Deep mode only: the downloaded bytes do not match the stored SHA-256 |
| `unreadable`    | The provider errored while inspecting the object                     |

An issue against a historical version carries its `versionId`, so a missing
old version is reported against that version rather than hidden behind the
current file.

The checker never deletes, rewrites or re-uploads anything. Repairs are a
separate, explicit step.

## Reconciliation

`POST /api/storage/reconciliation` compares the other way round: it lists the
channel and compares it with the user's records.

| Finding    | Meaning                                                                              |
| ---------- | ------------------------------------------------------------------------------------ |
| `unknown`  | A message exists in the channel that no file, version or in-flight upload references |
| `dangling` | A record points at a message that is no longer in the channel                        |

Two details keep the report honest:

- **In-flight uploads count as referenced.** Message ids held by
  `UploadOperation` rows in `PENDING`, `UPLOADING`, `UNKNOWN` or `COMMITTING`
  are protected, so a live upload is never reported as an orphan.
- **A partial scan says so.** The scan reads at most 5000 channel messages
  per request; when the cap is reached the report sets `truncated: true`.

### Repair

Repair is two explicit steps, and neither deletes anything from the channel.

```text
POST /api/storage/reconciliation/plan
        → { actions: [ { id, kind, messageId, reason, destructive: false } ] }
        (changes nothing)

POST /api/storage/reconciliation/apply
        { "approvedIds": ["adopt-9001", "detach-file-9002"] }
        → reruns the scan, applies only the ids the fresh plan still offers
```

| Action            | What it does                                                                                                          | Destructive |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- | ----------- |
| `detach-dangling` | Marks a record whose message is gone by moving it to the Trash                                                        | No          |
| `adopt-unknown`   | Creates a file record for a channel message that has none, using the object's real SHA-256 read from the stored bytes | No          |

An id the plan does not offer is refused with `400 INVALID_REQUEST`. An empty
list applies nothing.

`RepairPlan.deletions` is always empty. A channel message is never deleted:
it may be something the user stored themselves, and OmniCloud cannot prove it
owns it.

## Ordering and failure rules

The rules that decide which side of a two-system operation happens first.

| Operation                        | Order                                                      | On failure                                                                            |
| -------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Upload                           | Provider first, metadata second                            | The metadata is never written for bytes that were not stored                          |
| Commit after a successful upload | Metadata first; if the commit fails, the object is removed | A leftover that cannot be removed is recorded in the activity log with its message id |
| Permanent delete                 | Remote objects first, metadata second                      | Every row is kept so a retry can finish without orphaning an object                   |
| Delete one version               | Message first, row second                                  | The row is kept; the object is not stranded                                           |
| Prune versions                   | Message first, row second                                  | That version stays                                                                    |
| Trash                            | Database only — the remote object is untouched             | Restore is lossless                                                                   |
| Empty trash / retention purge    | Remote objects first, rows second                          | The failed files are reported in `failedFiles`                                        |
| Folder trash and restore         | Database only, in one transaction                          | The folders and their files never disagree                                            |

Two rules underpin all of them:

- **The database never advertises a file whose bytes were not stored.**
- **A failure is reported, never hidden.** Batch operations collect per-item
  failures instead of aborting the whole batch, and the empty-trash result
  says what could not be removed.

## Known constraints

See [limitations.md](./limitations.md) for the full list, including the
single-process scope and the fact that the upload and download paths are
tested against fake GramJS clients, with a live round trip against a real
account recorded separately.
