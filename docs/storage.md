# Storage architecture

## Principle

```text
Telegram = Physical Storage
PostgreSQL = Cloud Metadata
OmniCloud = Cloud Storage Layer
```

The application never talks to Telegram directly. Everything goes through the
`StorageProvider` abstraction (`packages/core/src/storage/provider.ts`):

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

The first implementation is `TelegramStorageProvider`
(`packages/telegram`). Future providers (S3, WebDAV, local disk) can be added
without touching the application layer.

## Telegram implementation details

- **Connection.** OmniCloud authenticates as the user's _Telegram account_
  via MTProto (GramJS). The session string is persisted in PostgreSQL
  (`TelegramSession`) and never exposed through the API.
- **Storage channel.** On first login a private broadcast channel
  ("OmniCloud Storage") is created. Its raw channel id and access hash are
  stored in the `Storage` table; every API call builds an explicit
  `InputPeerChannel` from those two values, so resolution never depends on
  client-side entity caches.
- **Upload.** Files are sent with `forceDocument: true` (never compressed as
  photos), producing one document message per file. The message id becomes
  the stored object reference.
- **Download.** The message is fetched by id from the channel and the media
  is downloaded. The SHA-256 of the downloaded bytes is compared with the
  checksum recorded at upload time and the result is exposed via the
  `X-Integrity-Verified` response header.
- **Delete.** The corresponding channel message is deleted; deleting an
  already-missing message is tolerated so metadata cleanup always completes.

## Ordering and failure rules

Upload: **provider first, metadata second.** A row in `files` only exists if
the Telegram upload succeeded. If metadata persistence fails after a
successful upload, the channel holds an orphan message — harmless, and
cleaned up whenever the file is deleted through OmniCloud.

Folder deletion: **best-effort remote cleanup, strict metadata cleanup.** If
individual Telegram deletions fail (network, rate limits), OmniCloud still
deletes the metadata so folders never get stuck; leftover messages are
harmless.

## What lives where

| Concern                         | Storage                                              |
| ------------------------------- | ---------------------------------------------------- |
| File bytes                      | Telegram channel                                     |
| Folder hierarchy                | PostgreSQL only                                      |
| File name/size/mime/sha256      | PostgreSQL                                           |
| Telegram ids (message, channel) | PostgreSQL                                           |
| Telegram session                | PostgreSQL                                           |
| Browser session                 | Opaque token cookie, checked server-side (revocable) |

## Known constraints

See [limitations.md](limitations.md) for the current list.
