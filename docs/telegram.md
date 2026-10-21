# Telegram integration

OmniCloud stores file bytes in a private Telegram channel owned by the user's
own account. This document covers why it uses the MTProto user API rather than
a bot, how to obtain credentials, the login and QR flows, how the MTProto
session is stored and sealed, the storage channel, the connection state
machine, the message-per-file model, the limits Telegram imposes, and what
Telegram can and cannot see.

Implementation lives in `packages/telegram/src/`.

## Contents

- [Why the user API (MTProto), not a bot](#why-the-user-api-mtproto-not-a-bot)
- [Obtaining api_id and api_hash](#obtaining-api_id-and-api_hash)
- [Sign-in flows](#sign-in-flows)
- [QR sign-in](#qr-sign-in)
- [Session handling and sealing](#session-handling-and-sealing)
- [The storage channel](#the-storage-channel)
- [Connection state machine](#connection-state-machine)
- [The message-per-file model](#the-message-per-file-model)
- [Size limits](#size-limits)
- [Rate limits and flood waits](#rate-limits-and-flood-waits)
- [RPC error mapping](#rpc-error-mapping)
- [What Telegram can and cannot see](#what-telegram-can-and-cannot-see)
- [Operational notes](#operational-notes)

## Why the user API (MTProto), not a bot

OmniCloud authenticates as the **user's own Telegram account** using the
MTProto user API (through the GramJS `telegram` package). A bot could not do
this:

- A bot account is a separate identity. It has no access to the user's files,
  and its storage is not the user's.
- The design goal is that the user owns the storage outright: the channel, its
  contents and the account are theirs. OmniCloud is a management layer, not a
  custodian of a third-party bucket.
- Bot API upload limits and bot `file_id` semantics are not suitable as an
  object store. The user API accepts a document of up to 2 GB in one message.

The trade-offs are real and documented elsewhere: the server holds a live
MTProto session with full account access (see [security.md](./security.md)),
and Telegram can read channel content, because Telegram channels have no
end-to-end encryption.

## Obtaining api_id and api_hash

Telegram requires every MTProto client to identify itself with an `api_id` /
`api_hash` pair.

1. Go to <https://my.telegram.org> and log in with the account that will host
   the storage (or any account — the pair identifies the _application_, not the
   storage owner).
2. Open **API development tools**.
3. Create an application with any name and short name. Copy the generated
   `api_id` (numeric) and `api_hash` (hex string).
4. Set them as environment variables:

```dotenv
TELEGRAM_API_ID=1234567
TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef
```

Both are required. `loadConfig` throws at startup when `TELEGRAM_API_ID` is
`0` or `TELEGRAM_API_HASH` is empty, so the server does not start half
configured.

| Variable            | Required | Purpose                                         |
| ------------------- | -------- | ----------------------------------------------- |
| `TELEGRAM_API_ID`   | yes      | The numeric application id from my.telegram.org |
| `TELEGRAM_API_HASH` | yes      | The application hash from my.telegram.org       |

Do not reuse one pair across many automated deployments — Telegram enforces
account-level limits on a pair.

## Sign-in flows

Two flows sign a user in. Both end in the same place: a session string in
PostgreSQL, a `User` row, and a private storage channel.

### Phone code

`TelegramConnectionService` (`packages/telegram/src/connection.ts`) implements
the flow and exposes it through three endpoints.

```text
POST /api/auth/telegram/start    { phone }
        │  client.sendCode(apiId, apiHash, phone)
        │  → stores { phone, client, phoneCodeHash, createdAt }
        ▼
POST /api/auth/telegram/verify   { phone, code }
        │  auth.SignIn({ phoneNumber, phoneCodeHash, phoneCode })
        ├─ SESSION_PASSWORD_NEEDED → { status: "password_required" }
        ▼
POST /api/auth/telegram/password { phone, password }
        │  account.GetPassword() → computeCheck() → auth.CheckPassword()
        ▼
      finalizeLogin():
        stringSession = client.session.save()
        getMe() → UserRepository.upsertFromTelegram()
        SessionRepository.save(userId, stringSession)
        ensureStorageForClient()  → creates "OmniCloud Storage"
        TelegramClientManager.cacheClient()
        issue session cookie
```

Details:

- **Pending flows live in memory and expire after 5 minutes**
  (`LOGIN_FLOW_TTL_MS`). A `verify` or `password` call with no pending flow
  for that phone returns `404 NOT_FOUND`; a call on a flow that has expired
  returns `400 INVALID_REQUEST`. Starting a new login for the same phone
  cancels the previous one and disconnects its client.
- **`computeCheck` is used for 2FA**, so the password is never sent to Telegram
  in the clear; GramJS derives the SRP check from the server's password
  parameters.
- **The user record is upserted by Telegram user id**, so signing in again
  with the same account reuses the OmniCloud user.
- **The channel is created during sign-in** (first sign-in), and
  `POST /api/storage/ensure` is the idempotent way to create it later.
- The endpoints are rate limited to **10 requests per minute per client IP**
  (`createRateLimiter({ windowMs: 60_000, max: 10 })`).

### QR sign-in

The QR flow never asks for a phone number or a code: the phone approves a
token that the server shows as a QR code.

```text
POST /api/auth/telegram/qr/start
        │  new client → connect
        │  auth.ExportLoginToken → tg://login?token=<base64url>
        │  → { flowId, token: { url, expiresAt } }
        ▼
GET /api/auth/telegram/qr/status?flowId=…
        │  while waiting: export a fresh token (Telegram rotates them
        │                 every few seconds) → { status: "waiting", token }
        │  on approval:  LoginTokenSuccess observed → finalize the login
        │  on 2FA:       → { status: "password_required" }
        ▼
POST /api/auth/telegram/qr/password  { flowId, password }
        │  account.GetPassword() → computeCheck() → auth.CheckPassword()
        ▼
      { status: "ok", user }  + session cookie
```

Details:

- The flow id is a random UUID; the client renders `token.url`
  (`tg://login?token=…`) as a QR code and the user approves it in the Telegram
  app on another device.
- **Approval is observed by polling `auth.ExportLoginToken`.** When it returns
  `LoginTokenSuccess`, the token was approved. A `LoginTokenMigrateTo` result
  means Telegram wants the client on another data centre: the flow switches DC
  and imports the token.
- **A background watcher polls every 2 seconds** (`QR_APPROVAL_POLL_MS`) and
  marks the flow approved, password-required or failed. A transient error
  leaves the previous token in place rather than failing the sign-in.
- **The flow expires after 5 minutes** (`QR_FLOW_TTL_MS`). A poll on an
  expired or unknown flow returns `404 NOT_FOUND` or
  `400 INVALID_REQUEST`.
- **The status route has its own, larger rate limit** (120 per minute per IP)
  because the UI polls it every few seconds, and it runs an explicit origin
  check: it can issue a session cookie, so a cross-origin page must not be
  able to trigger it. A request with no `Origin` header is treated as a
  non-browser client and is allowed through, exactly as the CSRF hook does.

## Session handling and sealing

The MTProto session string is the most sensitive value in the system: it
grants full access to the user's Telegram account.

### Lifecycle

- **Format.** A GramJS `StringSession` — a serialized auth key plus server and
  data-centre information. The client is always built with a `StringSession`,
  and `finalizeConnectedClient` checks the type rather than casting it, so a
  change of session type fails there instead of storing an unusable value.
- **Stored server-side only.** It is persisted in PostgreSQL and handed only
  to `TelegramClientManager`. It never appears in an API response, a DTO, an
  activity event's metadata or a log line.
- **Reconnects are lazy.** No session is opened at boot. The next operation for
  a user reconnects from the stored string, and a health read before that
  reports `DISCONNECTED`.
- **Logout drops the connection, not the session.** The in-memory connection
  is dropped and the browser session is revoked, but the row remains and the
  session is not revoked on Telegram's side. To truly revoke it, use Telegram
  **Settings → Devices**.
- **Revocation out of band.** If the session is invalidated on Telegram (a
  removed device, `AUTH_KEY_UNREGISTERED`, `SESSION_REVOKED`, account
  deactivation), the next operation surfaces `401 TELEGRAM_AUTH_REQUIRED` and
  the user must sign in again.

### Sealing at rest

The session string is sealed with **AES-256-GCM** before it reaches
PostgreSQL. `SecretBox` (`packages/core/src/utils/secret-box.ts`) does it:

| Property   | Value                                              |
| ---------- | -------------------------------------------------- |
| Algorithm  | AES-256-GCM (`aes-256-gcm`)                        |
| Key size   | 32 bytes                                           |
| IV         | A fresh random 96-bit value per seal               |
| Envelope   | `v<keyVersion>:<iv>:<tag>:<ciphertext>`, base64url |
| Key source | `OMNICLOUD_ENCRYPTION_KEY`                         |

The key version in the envelope prefix means a key can be rotated later by
keeping the older versions available for decryption.

`OMNICLOUD_ENCRYPTION_KEY` accepts either:

- **64 hex characters** (`openssl rand -hex 32`), used as the key bytes
  directly. This is the preferred form.
- **Any passphrase of at least 32 characters**, stretched with scrypt against a
  fixed salt, so a weak passphrase is expensive to brute-force.

Anything shorter than 32 characters is rejected at startup. A string that is
not 64 hex characters is stretched, so `openssl rand -hex 32` is the only
unambiguous way to supply a key.

> **Production requires the key.** `loadConfig` throws when
> `NODE_ENV=production` and `OMNICLOUD_ENCRYPTION_KEY` is empty. Without a key
> the sessions are stored unsealed — this is only possible outside production,
> and the readiness probe reports `encryption: not_configured` and answers
> `503`.

A legacy session stored before encryption was enabled has no `v<version>:`
prefix. The repository returns it, then writes it back sealed, so the upgrade
leaves no plaintext behind.

Losing the key makes every stored session unreadable. Users then sign in
again; nothing else is affected.

## The storage channel

`TelegramConnectionService.ensureStorageForClient` creates the backing store
on first use:

```text
channels.CreateChannel({
  title: "OmniCloud Storage",
  about: "Private storage channel created by OmniCloud (https://github.com/Hilbras/OmniCloud)",
  megagroup: false
})
```

- The result is a **private broadcast channel**. The created channel is
  extracted from the `Updates` payload; a missing access hash is a hard error.
- **Branding is cosmetic.** The channel photo is set to the OmniCloud logo and
  the channel is moved to the archive folder. Both failures are swallowed and
  never block the storage record.
- The stored registration (`Storage` row) holds `telegramChatId` (raw channel
  id), `telegramAccessHash`, `title`, `provider = "telegram"`, unique per
  user.
- Every provider call builds an explicit `InputPeerChannel(channelId,
accessHash)`. This deliberately avoids depending on GramJS entity caches, so
  storage keeps working after restarts and across channel lookups.
- `ensureStorage` is idempotent: it returns the existing registration when one
  exists and never creates a second channel.

## Connection state machine

`TelegramClientManager` owns at most one connection per user per process.
`ConnectionState` is one of:

| State           | Meaning                                                |
| --------------- | ------------------------------------------------------ |
| `DISCONNECTED`  | No managed connection yet (or none requested)          |
| `CONNECTING`    | A connect attempt is in flight                         |
| `CONNECTED`     | Client connected and usable                            |
| `RECONNECTING`  | An existing (stale) connection is being re-established |
| `ERROR`         | The last connect or probe failed for a non-auth reason |
| `AUTH_REQUIRED` | The session is invalid; the user must sign in again    |

Transitions:

```text
DISCONNECTED ──getForUser──▶ CONNECTING ──ok──▶ CONNECTED
                                             └─fail(auth)──▶ AUTH_REQUIRED
                                             └─fail(other)─▶ ERROR
CONNECTED ──client not connected──▶ RECONNECTING ──ok──▶ CONNECTED
                                              └─fail(auth)──▶ AUTH_REQUIRED
                                              └─fail(other)─▶ ERROR
```

Behavioural notes:

- `getForUser` returns the live client when `CONNECTED`, awaits an in-flight
  `pending` promise if one exists, throws `TELEGRAM_AUTH_REQUIRED` immediately
  in `AUTH_REQUIRED`, and otherwise reconnects.
- **Reconnects are cooldown-guarded.** `RECONNECT_COOLDOWN_MS` (5 s) prevents a
  burst of concurrent operations from each tearing down and re-establishing
  the connection. A reconnect in progress is shared via `pending`.
- `healthCheck(userId, deep)`:
  - Without a managed connection it attempts to connect; failure sets
    `AUTH_REQUIRED` or `ERROR`.
  - `deep: false` returns a **cached** result (`HEALTH_TTL_MS` = 30 s) without
    a round-trip.
  - `deep: true` calls `getMe()` and measures latency.
- `cacheClient` registers the already-authenticated client from the sign-in
  flow as `CONNECTED`, so the first operation after sign-in needs no reconnect.
- `disconnectUser` drops the in-memory connection (sign-out); `disconnectAll`
  is called during shutdown.
- `establish` uses `connectionRetries: 3` and validates `client.connected`
  immediately, so an expired session surfaces as `AUTH_REQUIRED` rather than as
  a generic failure on the first real operation.

## The message-per-file model

Every upload is a single document message in the channel, produced by
`TelegramStorageProvider.put`:

```text
client.sendFile(peer, {
  file: new CustomFile(name, size, "", data | path),
  forceDocument: true,     // never compress or convert to a photo
  workers: 1,
  caption,                  // "<sha256>:<operationId>" when the client sent one
  progressCallback,         // reports 0..1 progress, exposes isCanceled
})
```

- `forceDocument: true` means every file — including images and videos — is
  stored as a document, byte for byte, with its filename preserved in a
  `DocumentAttributeFilename`. Nothing is transcoded.
- **One message per version.** Replacing a file uploads a new document
  message; the old version's message stays in the channel until it is pruned
  or the file is permanently deleted. Each version row carries its own
  `telegramMessageId`.
- **The message id is the object reference.** `StoredRef` is just
  `{ messageId: string }`; `StoredObject` adds `name`, `size` and `mimeType`
  read back from the document.
- **The caption is set only for idempotent uploads.** When the client sends an
  `operationId`, the caption is `<sha256>:<operationId>`. It is what lets a
  later request find an upload whose outcome was unknown. An upload without an
  operation id gets no caption.
- **A spooled file is handed to GramJS by path**, so GramJS reads the parts it
  needs from disk. An in-memory buffer is passed through unchanged.
- `stat` fetches the message and returns `null` when the message or its media
  is gone; `get`/`requireMessage` throw `TELEGRAM_FILE_NOT_FOUND` in that
  case.
- `delete` removes the message with `revoke: true`. Deleting an
  already-missing message is tolerated by the abstraction contract, so
  metadata cleanup always completes.
- `getStream` streams Telegram download chunks through a `Readable`; the
  storage engine verifies the final SHA-256 before releasing the last chunk.
- `listObjects` pages through the channel and returns only messages that
  carry a document, newest first. Text and service messages are skipped.
- `findByCaption` searches the channel for a caption and a size. It is what
  resolves an `UNKNOWN` upload without writing a second copy.
- `healthCheck` verifies the client is connected and probes the channel with
  `channels.GetFullChannel`, returning the channel title and latency.

Progress and cancellation are surfaced through `TransferControl`: the callback
receives `{ transferred, total, percent }`, and an aborted `signal` makes the
progress callback report `isCanceled = true` so the upload aborts.

## Size limits

| Limit                        | Value                               | Where it comes from                                         |
| ---------------------------- | ----------------------------------- | ----------------------------------------------------------- |
| One Telegram document        | 2 GB (2 × 1024³ bytes)              | `MAX_DOCUMENT_BYTES` in `packages/telegram/src/provider.ts` |
| One OmniCloud upload         | `MAX_UPLOAD_MB` (256 MB by default) | `apps/api/src/config.ts`                                    |
| One `upload.getFile` request | 512 KiB                             | `DOWNLOAD_CHUNK_BYTES` in the provider                      |

- The provider rejects anything above the document cap with `UPLOAD_FAILED`
  **before any network work**, so the request never reaches Telegram.
- OmniCloud's own `MAX_UPLOAD_MB` is usually the binding limit. The
  multipart parser enforces it while the body is written, so an oversized
  upload is rejected without being stored in full.
- Downloads are not limited by size. They are streamed in 512 KiB chunks, so
  memory use stays bounded by one chunk regardless of file size.

## Rate limits and flood waits

**The rate limits are Telegram's, not OmniCloud's.** Telegram answers a
request that comes too fast with `FLOOD_WAIT_n`, where `n` is the number of
seconds to wait.

How OmniCloud handles it:

1. `mapTelegramError` reads the server's delay out of the RPC error and
   returns a `RateLimitedError` with `retryAfterSeconds: n`. The API surfaces
   it as `429 RATE_LIMITED`.
2. `RateLimitedError` declares itself **retryable**, so the storage engine
   retries the operation.
3. `retryDelayMs` honours a provider-supplied `retryAfterSeconds` **exactly** —
   the wait is the number of seconds Telegram asked for, not a guess. Only
   errors without a server-supplied delay fall back to exponential backoff with
   full jitter.
4. The default policy allows 3 attempts in total, with a 400 ms base delay.

Two limits OmniCloud applies itself:

| Limiter           | Budget                     | Applies to                                                        |
| ----------------- | -------------------------- | ----------------------------------------------------------------- |
| Sign-in limiter   | 10 requests / minute / IP  | `/api/auth/telegram/{start,verify,password,qr/start,qr/password}` |
| QR status limiter | 120 requests / minute / IP | `GET /api/auth/telegram/qr/status`                                |

Both are fixed-window and in-memory. They reset on restart and are not shared
between replicas.

**Upload transport failures are not blindly retried.** A `TelegramConnectionError`
raised by an upload may arrive _after_ Telegram already stored the object, so
the provider re-throws it with `retryable: false`. The operation is kept as
`UNKNOWN` and resolved by searching the channel for its caption, rather than
uploading the bytes a second time. A flood wait is different: it is a definite
rejection, so it is retried.

## RPC error mapping

`mapTelegramError` (`packages/telegram/src/errors.ts`) converts GramJS
failures into domain errors. Anything already a `DomainError` passes through
untouched.

| Telegram RPC error                                                                                                               | OmniCloud error                                              | HTTP | Code                         |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---- | ---------------------------- |
| `FLOOD_WAIT_n`                                                                                                                   | `RateLimitedError` ("retry in n seconds")                    | 429  | `RATE_LIMITED`               |
| `PHONE_NUMBER_INVALID`                                                                                                           | `ValidationError`                                            | 400  | `INVALID_REQUEST`            |
| `PHONE_NUMBER_UNOCCUPIED`                                                                                                        | `ValidationError`                                            | 400  | `INVALID_REQUEST`            |
| `PHONE_CODE_INVALID`                                                                                                             | `ValidationError`                                            | 400  | `INVALID_REQUEST`            |
| `PHONE_CODE_EXPIRED`                                                                                                             | `ValidationError`                                            | 400  | `INVALID_REQUEST`            |
| `PHONE_CODE_EMPTY`                                                                                                               | `ValidationError`                                            | 400  | `INVALID_REQUEST`            |
| `SESSION_PASSWORD_NEEDED`                                                                                                        | `UnauthorizedError`                                          | 401  | `AUTH_REQUIRED`              |
| `PASSWORD_HASH_INVALID`                                                                                                          | `ValidationError`                                            | 400  | `INVALID_REQUEST`            |
| `PHONE_NUMBER_BANNED`                                                                                                            | `ForbiddenError`                                             | 403  | `PERMISSION_DENIED`          |
| `AUTH_KEY_UNREGISTERED`, `AUTH_KEY_DUPLICATED`, `SESSION_REVOKED`, `SESSION_EXPIRED`, `USER_DEACTIVATED`, `USER_DEACTIVATED_BAN` | `TelegramAuthRequiredError`                                  | 401  | `TELEGRAM_AUTH_REQUIRED`     |
| `CHANNEL_PRIVATE`, `CHANNEL_INVALID`, `CHAT_ID_INVALID`, `PEER_ID_INVALID`                                                       | `StorageNotInitializedError`                                 | 409  | `STORAGE_NOT_INITIALIZED`    |
| `CHAT_WRITE_FORBIDDEN`, `CHAT_ADMIN_REQUIRED`                                                                                    | `ForbiddenError`                                             | 403  | `PERMISSION_DENIED`          |
| `MSG_ID_INVALID`, `MESSAGE_ID_INVALID`                                                                                           | `TelegramFileNotFoundError`                                  | 404  | `TELEGRAM_FILE_NOT_FOUND`    |
| `FILE_REFERENCE_EXPIRED`, `FILE_REFERENCE_INVALID`                                                                               | `TelegramFileNotFoundError` ("re-upload to refresh")         | 404  | `TELEGRAM_FILE_NOT_FOUND`    |
| Any other RPC error                                                                                                              | `TelegramConnectionError` (details carry the code + message) | 502  | `TELEGRAM_CONNECTION_FAILED` |
| Non-RPC error whose text matches `timeout`, `ECONNRESET`, `ENOTFOUND`, `socket`, `network`, `connect`                            | `TelegramConnectionError` (network error)                    | 502  | `TELEGRAM_CONNECTION_FAILED` |
| Any other non-RPC error                                                                                                          | `TelegramConnectionError`                                    | 502  | `TELEGRAM_CONNECTION_FAILED` |

`isPasswordRequiredError` recognizes `SESSION_PASSWORD_NEEDED` specifically, so
the sign-in flow can branch to the 2FA step. Mapped messages never contain
credentials or session material.

The `TelegramConnectionError` that a failed upload produces is re-thrown with
`retryable: false`, so the storage engine does not retry an upload whose
outcome is ambiguous.

## What Telegram can and cannot see

This is the boundary that matters, stated precisely.

### Telegram can see

- **The file bytes.** A channel has no end-to-end encryption, so Telegram can
  read the content of every message in it. For a plaintext upload that is the
  original file.
- **The file name at upload time.** `forceDocument: true` stores the name in
  the document's `DocumentAttributeFilename`. For a file stored under the OCE2
  opaque name this is the placeholder, not the real name.
- **The MIME type and size** of each document, as Telegram records them.
- **The message caption**, which for an idempotent upload is
  `<sha256>:<operationId>` — the content hash of the stored bytes and the
  client's operation id.
- **The channel itself**: the title "OmniCloud Storage", the about text, and
  the fact that the channel is a private broadcast channel owned by the
  account.
- **The account's own metadata**, which Telegram already holds for any
  account: device list, sessions, contacts.

### Telegram cannot see

- **The folder hierarchy.** Folders are virtual objects in PostgreSQL. There
  is no Telegram counterpart.
- **The stars, the trash state and the version graph.** `starred`,
  `deletedAt`, `trashBatchId`, `currentVersionId` and `versionCount` live only
  in PostgreSQL.
- **The activity log**, the browser sessions and the API tokens, and the
  stored hashes of any of them.
- **The encryption metadata.** `encryptionFormat`, `wrappedKey`,
  `metadataBlob` and `keyEpoch` are stored in PostgreSQL only. The server
  stores them without interpreting them.
- **Which document is which.** Telegram sees a flat list of documents in one
  channel. It does not know which of them are versions of the same file, which
  are starred, or what the OmniCloud account is called.

### What the server can see

Worth stating next to the above, because the server is a different party from
Telegram:

- For a **plaintext** file, the server sees the name, the MIME type, the size
  and the SHA-256 in PostgreSQL, and it proxies the bytes.
- For an **OCE1** file, the server sees the name in the clear in PostgreSQL
  and in the document filename attribute, and it stores the encrypted metadata
  blob without opening it.
- **OCE2**, which also hides the name, is implemented but **not enabled by
  default** and has not been independently reviewed. See
  [limitations.md](./limitations.md) and the audit note in
  [security.md](./security.md).

## Operational notes

- **One connection per user per process.** There is no cross-process session
  sharing; running multiple API replicas against the same account is out of
  scope and can trigger Telegram-side session duplication.
- **Restarts reconnect lazily.** No session is opened at boot; the first
  operation for a user reconnects from the stored string. Health reads before
  that report `DISCONNECTED`.
- **`TRUST_PROXY` and deployment do not affect MTProto.** It only matters for
  client IPs behind a reverse proxy.
- **Channel deletion is destructive.** If the user deletes the "OmniCloud
  Storage" channel in Telegram, operations surface
  `STORAGE_NOT_INITIALIZED` (`CHANNEL_PRIVATE` / `CHANNEL_INVALID`), and
  metadata still points at channel messages that no longer exist — integrity
  checks report them as `missing`. Re-running `/api/storage/ensure` creates a
  new channel, but it does not re-upload existing content.
- **Sessions can be revoked out of band.** The user can remove the device in
  Telegram, after which every storage call returns
  `TELEGRAM_AUTH_REQUIRED` until they sign in again.
- **The upload and download paths are tested against fake GramJS clients.** A
  live round trip against a real account is recorded in
  [`audits/live-e2ee-smoke.md`](./audits/live-e2ee-smoke.md), but real chunk
  behaviour, speed and Telegram's own limits still have to be checked on your
  own account. See [limitations.md](./limitations.md).

## Related

- [architecture.md](./architecture.md) — the layers, the request lifecycle and
  the upload and download pipelines.
- [storage.md](./storage.md) — the storage lifecycle: upload, download,
  versions, trash and integrity.
- [storage-provider.md](./storage-provider.md) — the provider contract and the
  engine wrapper.
- [api.md](./api.md) — the HTTP reference for the sign-in, storage and
  reconciliation endpoints.
