# Telegram integration

OmniCloud stores file bytes in a private Telegram channel owned by the user's
own account. This document covers why it uses MTProto rather than a bot, how to
obtain credentials, the login and session lifecycle, the storage channel, the
connection state machine, the file model and the RPC error mapping.

Implementation lives in `packages/telegram/src/`.

## Why the user API (MTProto), not a bot

OmniCloud authenticates as the **user's own Telegram account** using the MTProto
user API (via the GramJS `telegram` package). A bot could not do this:

- A bot account is a separate identity; it has no access to the user's files
  and its storage is not the user's.
- The design goal is that the user owns the storage outright: the channel, its
  contents and the account are theirs. OmniCloud is a management layer, not a
  custodian of a third-party bucket.
- Bot API upload limits and bot "file_id" semantics are not suitable as an
  object store; the user API allows arbitrary documents up to 2 GB each.

The trade-offs are real and documented elsewhere: the server holds a live
MTProto session with full account access (see
[security.md](./security.md)), and Telegram can technically read channel
content (no end-to-end encryption).

## Obtaining api_id / api_hash

Telegram requires every MTProto client to identify itself with a `api_id` /
`api_hash` pair:

1. Go to <https://my.telegram.org> and log in with the account that will host
   the storage (or any account; the pair identifies the _application_, not the
   storage owner).
2. Open **API development tools**.
3. Create an application (any name/short name). Copy the generated `api_id`
   (numeric) and `api_hash` (hex string).
4. Set them as environment variables:

```dotenv
TELEGRAM_API_ID=1234567
TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef
```

Both are required: `loadConfig` throws at startup if `TELEGRAM_API_ID` is `0`
or `TELEGRAM_API_HASH` is empty. Do not reuse one pair across many automated
deployments — Telegram enforces account-level limits on a pair.

## Login flow

The flow is implemented by `TelegramConnectionService`
(`connection.ts`) and exposed through three API endpoints.

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

- **Pending flows are in-memory and expire after 5 minutes.** A flow older than
  that, or a `verify`/`password` call with no pending flow, returns
  `404 NOT_FOUND` / `400 INVALID_REQUEST`. Starting a new login for the same
  phone cancels the previous one (disconnects its client).
- **`computeCheck` is used for 2FA**, so the password is never sent to Telegram
  in the clear; GramJS derives the SRP check from the server's password
  parameters.
- **The user record is upserted by Telegram user id**, so signing in again with
  the same account reuses the OmniCloud user.
- **The channel is created during login** (first sign-in), and
  `POST /api/storage/ensure` is the idempotent way to create it later.

## Session string lifecycle

- Format: GramJS `StringSession` (a serialized auth key + server + dc info),
  stored verbatim in `TelegramSession.stringSession`.
- **Stored server-side only.** It is persisted in PostgreSQL and handed only to
  `TelegramClientManager`. It never appears in an API response, a DTO, an
  activity event's metadata, or a log line.
- On logout the connection is dropped from memory, but the row remains and the
  session is not revoked on Telegram's side. To truly revoke it, use Telegram
  **Settings → Devices**.
- On a process restart, no session is eagerly loaded; the next operation for a
  user reconnects lazily from the stored string.

If the session is invalidated on Telegram (device removal, `AUTH_KEY_*`,
`SESSION_REVOKED`, account deactivation), the next operation surfaces
`401 TELEGRAM_AUTH_REQUIRED` and the user must sign in again.

## Storage channel

`TelegramConnectionService.ensureStorageForClient` creates the backing store on
first use:

```text
channels.CreateChannel({
  title: "OmniCloud Storage",
  about: "Private storage channel created by OmniCloud (...)",
  megagroup: false
})
```

- The result is a **private broadcast channel**. The created channel is
  extracted from the `Updates` payload; missing access hash is a hard error.
- Stored registration (`Storage` row): `telegramChatId` (raw channel id),
  `telegramAccessHash`, `title`, `provider = "telegram"`, unique per user.
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
| `ERROR`         | The last connect/probe failed for a non-auth reason    |
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

Behavioral notes:

- `getForUser` returns the live client when `CONNECTED`, awaits an in-flight
  `pending` promise if one exists, throws `TELEGRAM_AUTH_REQUIRED` immediately in
  `AUTH_REQUIRED`, and otherwise reconnects.
- **Reconnects are cooldown-guarded**: `RECONNECT_COOLDOWN_MS` (5 s) prevents a
  burst of concurrent operations from each tearing down and re-establishing the
  connection. A reconnect in progress is shared via `pending`.
- `healthCheck(userId, deep)`:
  - Without a managed connection, it attempts to connect; failure sets
    `AUTH_REQUIRED` or `ERROR`.
  - `deep: false` returns a **cached** result (`HEALTH_TTL_MS` = 30 s) without a
    round-trip.
  - `deep: true` calls `getMe()` and measures latency.
- `cacheClient` registers the already-authenticated client from the login flow
  as `CONNECTED`, so the first operation after login needs no reconnect.
- `disconnectUser` drops the in-memory connection (logout); `disconnectAll` is
  called during shutdown.
- `establish` uses `connectionRetries: 3` and validates `client.connected`
  immediately, so an expired session surfaces as `AUTH_REQUIRED` rather than as
  a generic failure on the first real operation.

## File model

Every upload is a single document message in the channel, produced by
`TelegramStorageProvider.put`:

```text
client.sendFile(peer, {
  file: new CustomFile(name, size, "", data),
  forceDocument: true,     // never compress/convert to a photo
  workers: 1,
  progressCallback,        // reports 0..1 progress, exposes isCanceled
})
```

- `forceDocument: true` means every file — including images and videos — is
  stored as a document, byte-for-byte, with its filename preserved in a
  `DocumentAttributeFilename`. Nothing is transcoded.
- **The message id is the object reference.** `StoredRef` is just
  `{ messageId: string }`; `StoredObject` adds `name`, `size` and `mimeType`
  read back from the document.
- **The per-document cap is 2 GB** (`MAX_DOCUMENT_BYTES`). Larger uploads are
  rejected with `UPLOAD_FAILED` before any network work. OmniCloud's own
  `MAX_UPLOAD_MB` is usually the binding limit.
- `stat` fetches the message and returns `null` when the message or its media is
  gone; `get`/`requireMessage` throw `TELEGRAM_FILE_NOT_FOUND` in that case.
- `delete` removes the message with `revoke: true`. Deleting an already-missing
  message is tolerated by the abstraction contract.
- `getStream` currently buffers and re-exposes the result as a one-chunk
  stream; true chunked streaming is a v0.3 concern.
- `healthCheck` verifies the client is connected and probes the channel with
  `channels.GetFullChannel`, returning the channel title and latency.

Progress and cancellation are surfaced through `TransferControl`: the callback
receives `{ transferred, total, percent }`, and an aborted `signal` makes the
progress callback report `isCanceled = true` so the upload aborts.

## RPC error mapping

`mapTelegramError` (`errors.ts`) converts GramJS failures into domain errors.
Anything already a `DomainError` passes through untouched.

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
| `CHANNEL_PRIVATE`, `CHANNEL_INVALID`, `CHAT_ID_INVALID`                                                                          | `StorageNotInitializedError`                                 | 409  | `STORAGE_NOT_INITIALIZED`    |
| `MSG_ID_INVALID`, `MESSAGE_ID_INVALID`                                                                                           | `TelegramFileNotFoundError`                                  | 404  | `TELEGRAM_FILE_NOT_FOUND`    |
| `FILE_REFERENCE_EXPIRED`, `FILE_REFERENCE_INVALID`                                                                               | `TelegramFileNotFoundError` ("re-upload to refresh")         | 404  | `TELEGRAM_FILE_NOT_FOUND`    |
| Any other RPC error                                                                                                              | `TelegramConnectionError` (details carry the code + message) | 502  | `TELEGRAM_CONNECTION_FAILED` |
| Non-RPC error whose text matches `timeout`, `ECONNRESET`, `ENOTFOUND`, `socket`, `network`, `connect`                            | `TelegramConnectionError` (network error)                    | 502  | `TELEGRAM_CONNECTION_FAILED` |
| Any other non-RPC error                                                                                                          | `TelegramConnectionError`                                    | 502  | `TELEGRAM_CONNECTION_FAILED` |

`isPasswordRequiredError` recognizes `SESSION_PASSWORD_NEEDED` specifically, so
the login flow can branch to the 2FA step. Mapped messages never contain
credentials or session material.

## Operational notes

- **Rate limits are Telegram's, not ours.** Telegram answers with `FLOOD_WAIT_n`
  seconds; OmniCloud maps it to `429 RATE_LIMITED` and the client must wait. The
  `StorageEngine` deliberately does not retry `FLOOD_WAIT` (it will not resolve
  itself quickly), but it does retry transient transport failures.
- **One connection per user per process.** There is no cross-process session
  sharing; running multiple API replicas against the same account is out of
  scope and can trigger Telegram-side session duplication.
- **Restarts reconnect lazily.** No session is opened at boot; the first
  operation for a user reconnects from the stored string. Health reads before
  that report `DISCONNECTED`.
- **`TRUST_PROXY` / deployment** does not affect MTProto; it only matters for
  client IPs behind a reverse proxy.
- **Channel deletion is destructive.** If the user deletes the "OmniCloud
  Storage" channel in Telegram, operations surface `STORAGE_NOT_INITIALIZED`
  (`CHANNEL_PRIVATE`/`CHANNEL_INVALID`) and metadata still points at channel
  messages that no longer exist — integrity checks will report them as
  `missing`. Re-running `/api/storage/ensure` creates a new channel, but it will
  not re-upload existing content.
- **Sessions can be revoked out of band.** The user can remove the device in
  Telegram, after which every storage call returns
  `TELEGRAM_AUTH_REQUIRED` until they sign in again.
