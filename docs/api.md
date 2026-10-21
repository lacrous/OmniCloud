# HTTP API reference

OmniCloud serves its HTTP API from the Fastify application in `apps/api`. Every
endpoint lives under `/api`. The API speaks JSON, except uploads
(`multipart/form-data`) and downloads (raw bytes).

This document is the authoritative reference. Every route, parameter and
response shape below is taken from the source in `apps/api/src/routes/`,
`apps/api/src/app.ts` and `packages/shared`.

## Contents

- [Conventions](#conventions)
  - [Base URL and content types](#base-url-and-content-types)
  - [Request pipeline](#request-pipeline)
  - [Request id](#request-id)
  - [Security headers](#security-headers)
  - [Cross-origin and CSRF](#cross-origin-and-csrf)
  - [Authentication](#authentication)
  - [Error envelope](#error-envelope)
  - [Pagination](#pagination)
  - [Sorting and filtering](#sorting-and-filtering)
  - [Batch operations](#batch-operations)
- [Health](#health)
- [Auth](#auth)
- [Storage](#storage)
- [Files](#files)
- [Folders](#folders)
- [Trash](#trash)
- [Collections](#collections)
  - [Search query language](#search-query-language)
- [Tokens](#tokens)
- [Update](#update)
- [Error codes](#error-codes)

---

## Conventions

### Base URL and content types

| Aspect        | Value                                                                         |
| ------------- | ----------------------------------------------------------------------------- |
| Base path     | `/api`                                                                        |
| Request body  | JSON, except uploads which are `multipart/form-data`                          |
| Response body | JSON, except downloads which stream raw bytes                                 |
| Response code | `200` by default; `201` for created resources; `204` with no body for deletes |
| Character set | UTF-8                                                                         |

The API also serves the built web application from the same port when
`WEB_DIST_DIR` points at a build. Those requests are not API requests.

### Request pipeline

Every request runs through the same hooks, in this order:

1. **Request id** — taken from the inbound `x-request-id` header or generated
   as a UUID. It is echoed on the response and included in every error body.
2. **Security headers** — a fixed baseline set on every response.
3. **Origin check** — state-changing requests (`POST`, `PUT`, `PATCH`,
   `DELETE`) must come from an allowed origin.
4. **Authentication** — every `/api` route needs a session, except
   `/api/auth/*`, `/api/health*` and `/api/update/*`.
5. **Route → service → repository → storage provider.** Mutations record an
   activity event as a side effect.
6. **Error handler** — maps domain errors to the [error envelope](#error-envelope).

JSON request bodies are capped at 2 MB. Uploads are limited by the multipart
limits instead: one file part, at most 10 parts, and `MAX_UPLOAD_MB` per file
(256 MB by default).

> Records owned by another user are answered with `404` (`FILE_NOT_FOUND` /
> `FOLDER_NOT_FOUND` / `NOT_FOUND`), never `403`, so their existence is not
> leaked.

### Request id

| Header         | Direction          | Notes                                                   |
| -------------- | ------------------ | ------------------------------------------------------- |
| `x-request-id` | request (optional) | Honored when 1–128 chars; otherwise a UUID is generated |
| `x-request-id` | response (always)  | Echoes the effective request id                         |

Quote the value when reporting a problem: the same id appears in the
structured server logs.

### Security headers

Every response carries these headers:

| Header                              | Value                                      |
| ----------------------------------- | ------------------------------------------ |
| `X-Content-Type-Options`            | `nosniff`                                  |
| `X-Frame-Options`                   | `DENY`                                     |
| `Referrer-Policy`                   | `no-referrer`                              |
| `Cross-Origin-Resource-Policy`      | `same-origin`                              |
| `Cross-Origin-Opener-Policy`        | `same-origin`                              |
| `Permissions-Policy`                | `geolocation=(), microphone=(), camera=()` |
| `X-Permitted-Cross-Domain-Policies` | `none`                                     |

The Content-Security-Policy for the web app is set separately, on the page
response rather than the API responses. The full baseline is described in
[security.md](./security.md).

### Cross-origin and CSRF

For `POST`, `PUT`, `PATCH` and `DELETE`:

- If `ALLOWED_ORIGINS` is set, the request's `Origin` must exactly match one of
  the listed origins.
- Otherwise the origin's host must equal the request `Host` header
  (same-origin).
- A request with **no** `Origin` header (curl, the SDK, server-to-server) is
  permitted.

A rejected cross-origin request returns `403 PERMISSION_DENIED`. The QR status
route applies the same check itself, because it can mint a session cookie.

### Authentication

Two credentials work:

| Credential         | How to send it                      | Scope                              |
| ------------------ | ----------------------------------- | ---------------------------------- |
| Browser session    | `Cookie: omnicloud_session=<token>` | Every route except the public ones |
| Personal API token | `Authorization: Bearer <token>`     | Every route except the public ones |

The browser session is an HttpOnly, SameSite=Lax cookie named
`omnicloud_session` (constant `SESSION_COOKIE`). It carries an opaque random
token, not a JWT. The server stores only the token's SHA-256, checks it on
every request, and expires it after 30 days (`DEFAULT_SESSION_TTL_DAYS`).
Logout revokes the row at once, so a copied cookie stops working.

Personal API tokens come from `POST /api/tokens` and are sent as a bearer
token. Only a hash of each secret is stored, and the secret is shown exactly
once. See [Tokens](#tokens).

> The Telegram MTProto session is never sent to clients. It lives server-side
> only.

### Error envelope

Every non-2xx API response has this shape:

```json
{
  "error": {
    "code": "FILE_NOT_FOUND",
    "message": "File not found",
    "requestId": "3f1c2b9e-6f0d-4f4e-9a0b-1c2d3e4f5a6b"
  }
}
```

| Field       | Type    | Notes                                                                                                                     |
| ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| `code`      | string  | One of the [error codes](#error-codes). Stable and machine-readable.                                                      |
| `message`   | string  | Human-readable and safe to display. Telegram credential or session material is never included.                            |
| `requestId` | string  | Correlates the response with the server logs.                                                                             |
| `details`   | unknown | Present only on some errors, for example the raw Telegram error code in `TELEGRAM_CONNECTION_FAILED`. Omitted when empty. |

The TypeScript shape is `ApiErrorBody` in `packages/shared/src/index.ts`.

> The three `/api/auth/recovery` routes answer an unauthenticated request with
> a hand-written body that carries `code` and `message` but **no**
> `requestId`.

### Pagination

Every listing endpoint returns a pagination envelope:

```json
{ "page": 1, "limit": 50, "total": 123, "hasMore": true }
```

| Field     | Meaning                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------- |
| `page`    | 1-based page number. Invalid values fall back to `1`.                                                 |
| `limit`   | Page size. Invalid values fall back to `50` (`DEFAULT_PAGE_SIZE`); capped at `200` (`MAX_PAGE_SIZE`). |
| `total`   | Total matching items. For combined file+folder listings this is the sum of both totals.               |
| `hasMore` | `page * limit < total`.                                                                               |

### Sorting and filtering

Shared by `GET /api/files`, `GET /api/folders`, `GET /api/trash` and
`GET /api/starred`. `GET /api/recent`, `GET /api/search` and `GET /api/activity`
read only `page` and `limit`.

| Parameter | Type     | Values                                           | Notes                                                                                  |
| --------- | -------- | ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `page`    | integer  | ≥ 1                                              | Default `1`                                                                            |
| `limit`   | integer  | 1–200                                            | Default `50`                                                                           |
| `sort`    | string   | `name`, `size`, `createdAt`, `updatedAt`, `type` | Unknown values are ignored                                                             |
| `order`   | string   | `asc`, `desc`                                    | Default `asc`                                                                          |
| `status`  | string   | `active`, `trashed`, `all`                       | Default `active`; unknown values fall back to `active`                                 |
| `q`       | string   | —                                                | Case-insensitive name substring filter                                                 |
| `type`    | string   | category or MIME type                            | `image`, `video`, `audio`, `pdf`, `archive`, `document`, `text`, or an exact MIME type |
| `ext`     | string   | extension without dot                            | `zip`, `pdf`                                                                           |
| `starred` | boolean  | `true`/`false` (`1`/`0` accepted)                |                                                                                        |
| `minSize` | integer  | bytes, ≥ 0                                       |                                                                                        |
| `maxSize` | integer  | bytes, ≥ 0                                       |                                                                                        |
| `from`    | ISO date | —                                                | Inclusive lower bound on `createdAt`                                                   |
| `to`      | ISO date | —                                                | Inclusive upper bound on `createdAt`                                                   |

Notes:

- `sort=name` is the default for files and folders. Unknown `sort` and `order`
  values are ignored rather than rejected.
- `sort=size` and `sort=type` apply to files; folders fall back to name for
  those fields.
- `type=other` has no MIME matchers, so the filter is dropped and every file
  matches.
- Blank or unknown query string values are ignored; the request is not
  rejected.
- `minSize` and `maxSize` are plain byte counts. The `size:` operator of the
  [search query language](#search-query-language) is the friendlier form.

### Batch operations

`POST /api/files/batch` and `POST /api/folders/batch` accept 1–500 unique ids
and return per-item results. A bad item does not abort the batch:

```json
{
  "requested": 3,
  "succeeded": 2,
  "failed": 1,
  "errors": [
    { "id": "tz4a98xxat96iws9zmbrgj3a", "code": "INVALID_REQUEST", "message": "File not found" }
  ]
}
```

The `code` in a batch error is always `INVALID_REQUEST`; the `message` carries
the per-item reason.

Send an optional `operationId` (8–64 characters `[A-Za-z0-9_-]`) in the request
body to correlate a batch with its result. It is echoed back as `operationId`.
Batch operations are safe to repeat: trashing, starring, moving and restoring
an item that is already in that state does not change it again.

---

## Health

Public probes. No session is required.

| Endpoint                   | Method | Auth | Purpose                                       |
| -------------------------- | ------ | ---- | --------------------------------------------- |
| `GET /api/health`          | GET    | none | Overall status plus database probe            |
| `GET /api/health/live`     | GET    | none | Liveness: the process is running              |
| `GET /api/health/ready`    | GET    | none | Readiness: database and encryption configured |
| `GET /api/health/database` | GET    | none | Database probe only                           |

### `GET /api/health`

Probes the database and reports the running version.

**Request**

```bash
curl -sS https://omnicloud.example.com/api/health
```

**Response** `200`

```json
{
  "status": "healthy",
  "database": "healthy",
  "storage": "unknown",
  "uptimeSeconds": 3600,
  "version": "0.5.0"
}
```

`status` mirrors `database`, which is `healthy` or `unavailable`. `storage` is
always `unknown` here because the storage backend is per user; use
`GET /api/storage/health` for the signed-in user's storage.

### `GET /api/health/live`

Liveness. It checks no dependency on purpose: a database outage must not make
an orchestrator restart a process that could otherwise recover.

**Request**

```bash
curl -sS https://omnicloud.example.com/api/health/live
```

**Response** `200`

```json
{ "status": "live" }
```

### `GET /api/health/ready`

Readiness. Ready only when the database answers **and** encryption is
configured. Storage is not part of readiness, because a user may not have
connected Telegram yet and sign-in must keep working.

**Request**

```bash
curl -sS -i https://omnicloud.example.com/api/health/ready
```

**Response** `200` when ready, `503` when not

```json
{
  "ready": true,
  "checks": [
    { "name": "database", "state": "healthy", "detail": null },
    { "name": "encryption", "state": "healthy", "detail": null }
  ]
}
```

| Check        | `state` values              | `detail`                                            |
| ------------ | --------------------------- | --------------------------------------------------- |
| `database`   | `healthy`, `unhealthy`      | `"database did not answer"` when unhealthy          |
| `encryption` | `healthy`, `not_configured` | Explains that `OMNICLOUD_ENCRYPTION_KEY` is not set |

> With `OMNICLOUD_ENCRYPTION_KEY` unset, the encryption check is
> `not_configured`, so `ready` is `false` and the endpoint answers `503`.

Probe output never contains error text from a dependency, so connection strings
and credentials cannot leak through it.

### `GET /api/health/database`

**Request**

```bash
curl -sS https://omnicloud.example.com/api/health/database
```

**Response** `200`

```json
{ "status": "healthy", "database": "healthy" }
```

A cheap query proves PostgreSQL connectivity without loading data.

---

## Auth

The login flow talks to Telegram over MTProto (the user API), as described in
[telegram.md](./telegram.md). The Telegram session itself never leaves the
server.

| Endpoint                              | Method | Auth             | Purpose                                    |
| ------------------------------------- | ------ | ---------------- | ------------------------------------------ |
| `POST /api/auth/telegram/start`       | POST   | none             | Send the Telegram confirmation code        |
| `POST /api/auth/telegram/verify`      | POST   | none             | Check the confirmation code                |
| `POST /api/auth/telegram/password`    | POST   | none             | Two-factor password step of the phone flow |
| `POST /api/auth/telegram/qr/start`    | POST   | none             | Start a QR sign-in                         |
| `GET /api/auth/telegram/qr/status`    | GET    | none             | Poll a QR sign-in                          |
| `POST /api/auth/telegram/qr/password` | POST   | none             | Two-factor password step of the QR flow    |
| `GET /api/auth/me`                    | GET    | cookie only      | Current session                            |
| `POST /api/auth/logout`               | POST   | session cookie   | Sign out of this session                   |
| `POST /api/auth/logout-all`           | POST   | session cookie   | Sign out of every session                  |
| `GET /api/auth/recovery`              | GET    | session or token | Read the stored recovery blob              |
| `PUT /api/auth/recovery`              | PUT    | session or token | Store the recovery blob                    |
| `DELETE /api/auth/recovery`           | DELETE | session or token | Clear the recovery blob                    |

### Rate limits

The auth routes use an in-memory, fixed-window limiter keyed by IP.

| Route family                                                                                          | Limit per minute per IP |
| ----------------------------------------------------------------------------------------------------- | ----------------------- |
| `telegram/start`, `telegram/verify`, `telegram/password`, `telegram/qr/start`, `telegram/qr/password` | 10                      |
| `telegram/qr/status`                                                                                  | 120                     |
| `PUT` and `DELETE /api/auth/recovery`                                                                 | 20                      |

Exceeding a limit returns `429 RATE_LIMITED`.

> OmniCloud has no separate account password. The only password in the flow is
> the **Telegram two-factor password**, entered on the password step of the
> phone flow or of the QR flow.

### `POST /api/auth/telegram/start`

Sends the Telegram confirmation code to the phone number.

**Body**

| Field   | Type   | Required | Notes                                                                                   |
| ------- | ------ | -------- | --------------------------------------------------------------------------------------- |
| `phone` | string | yes      | International format, matching `^\+?[0-9]\d{4,14}$` (5–15 digits, optional leading `+`) |

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/auth/telegram/start \
  -H "Content-Type: application/json" \
  -d '{"phone": "+15551234567"}'
```

**Response** `200`

```json
{ "ok": true }
```

**Errors**

| Status | Code                         | Cause                                                                            |
| ------ | ---------------------------- | -------------------------------------------------------------------------------- |
| 400    | `INVALID_REQUEST`            | The phone number does not match the pattern                                      |
| 400    | `INVALID_REQUEST`            | Telegram rejected the number (`PHONE_NUMBER_INVALID`, `PHONE_NUMBER_UNOCCUPIED`) |
| 403    | `PERMISSION_DENIED`          | The number is banned from Telegram (`PHONE_NUMBER_BANNED`)                       |
| 429    | `RATE_LIMITED`               | Too many attempts from this IP                                                   |
| 502    | `TELEGRAM_CONNECTION_FAILED` | Telegram was unreachable                                                         |

Starting a new login cancels any pending login for the same phone number.

### `POST /api/auth/telegram/verify`

Checks the confirmation code Telegram sent to the phone.

**Body**

| Field   | Type   | Required | Notes                          |
| ------- | ------ | -------- | ------------------------------ |
| `phone` | string | yes      | The same number as `start`     |
| `code`  | string | yes      | Numeric, matching `^\d{3,10}$` |

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/auth/telegram/verify \
  -H "Content-Type: application/json" \
  -d '{"phone": "+15551234567", "code": "12345"}'
```

**Response** `200`, two-factor authentication disabled — sets the session cookie

```json
{
  "status": "ok",
  "user": {
    "id": "tz4a98xxat96iws9zmbrgj3a",
    "username": "jane",
    "firstName": "Jane",
    "lastName": null
  }
}
```

**Response** `200`, two-factor authentication enabled — no cookie yet

```json
{ "status": "password_required" }
```

**Errors**

| Status | Code              | Cause                                                                                                   |
| ------ | ----------------- | ------------------------------------------------------------------------------------------------------- |
| 400    | `INVALID_REQUEST` | Wrong code (`PHONE_CODE_INVALID`), expired code (`PHONE_CODE_EXPIRED`), empty code (`PHONE_CODE_EMPTY`) |
| 400    | `INVALID_REQUEST` | The login flow is older than 5 minutes                                                                  |
| 404    | `NOT_FOUND`       | No pending login for this phone number                                                                  |
| 429    | `RATE_LIMITED`    | Too many attempts from this IP                                                                          |

On the first successful sign-in the private storage channel is created, which
can take a few seconds.

### `POST /api/auth/telegram/password`

Completes the phone flow for an account with two-factor authentication.

**Body**

| Field      | Type   | Required | Notes                                                    |
| ---------- | ------ | -------- | -------------------------------------------------------- |
| `phone`    | string | yes      | The pending login's phone number                         |
| `password` | string | yes      | The Telegram two-factor password, at least one character |

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/auth/telegram/password \
  -H "Content-Type: application/json" \
  -d '{"phone": "+15551234567", "password": "••••••"}'
```

**Response** `200` — sets the session cookie

```json
{
  "status": "ok",
  "user": {
    "id": "tz4a98xxat96iws9zmbrgj3a",
    "username": "jane",
    "firstName": "Jane",
    "lastName": null
  }
}
```

**Errors**

| Status | Code              | Cause                                                   |
| ------ | ----------------- | ------------------------------------------------------- |
| 400    | `INVALID_REQUEST` | Incorrect two-factor password (`PASSWORD_HASH_INVALID`) |
| 400    | `INVALID_REQUEST` | The login flow is older than 5 minutes                  |
| 404    | `NOT_FOUND`       | No pending login for this phone number                  |
| 429    | `RATE_LIMITED`    | Too many attempts from this IP                          |

### `POST /api/auth/telegram/qr/start`

Starts a QR sign-in. The phone approves the returned token in the Telegram app
(Settings → Devices → Link Desktop Device). Tokens rotate, so poll the status
route.

**Body** — none.

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/auth/telegram/qr/start
```

**Response** `200`

```json
{
  "flowId": "8c1f2a44-9d1e-4b6a-8f31-2f9b0a7c5d10",
  "token": { "url": "tg://login?token=AQFlbGxvLXdvcmxk", "expiresAt": 1791580000000 }
}
```

**Errors**: `429 RATE_LIMITED`, `502 TELEGRAM_CONNECTION_FAILED`.

### `GET /api/auth/telegram/qr/status`

Reports where a QR sign-in stands. The route applies the origin check itself,
because it can mint a session cookie.

**Query parameters**

| Parameter | Type   | Required | Notes           |
| --------- | ------ | -------- | --------------- |
| `flowId`  | string | yes      | From `qr/start` |

**Request**

```bash
curl -sS "https://omnicloud.example.com/api/auth/telegram/qr/status?flowId=8c1f2a44-9d1e-4b6a-8f31-2f9b0a7c5d10"
```

**Response** `200`, not approved yet — the token is rotated, use the new one

```json
{
  "status": "waiting",
  "token": { "url": "tg://login?token=AQFlbGxvLXdvcmxkMg", "expiresAt": 1791580000000 }
}
```

**Response** `200`, approved — sets the session cookie

```json
{
  "status": "ok",
  "user": {
    "id": "tz4a98xxat96iws9zmbrgj3a",
    "username": "jane",
    "firstName": "Jane",
    "lastName": null
  }
}
```

**Response** `200`, two-factor account

```json
{ "status": "password_required" }
```

**Errors**

| Status | Code                | Cause                                     |
| ------ | ------------------- | ----------------------------------------- |
| 400    | `INVALID_REQUEST`   | The QR flow expired (5 minutes)           |
| 403    | `PERMISSION_DENIED` | The request came from a disallowed origin |
| 404    | `NOT_FOUND`         | The QR flow has ended; start again        |
| 429    | `RATE_LIMITED`      | Too many polls from this IP               |

### `POST /api/auth/telegram/qr/password`

Completes a QR sign-in for an account with two-factor authentication.

**Body**

| Field      | Type   | Required | Notes                            |
| ---------- | ------ | -------- | -------------------------------- |
| `flowId`   | string | yes      | The QR flow id                   |
| `password` | string | yes      | The Telegram two-factor password |

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/auth/telegram/qr/password \
  -H "Content-Type: application/json" \
  -d '{"flowId": "8c1f2a44-9d1e-4b6a-8f31-2f9b0a7c5d10", "password": "••••••"}'
```

**Response** `200` — sets the session cookie

```json
{
  "status": "ok",
  "user": {
    "id": "tz4a98xxat96iws9zmbrgj3a",
    "username": "jane",
    "firstName": "Jane",
    "lastName": null
  }
}
```

**Errors**: `400 INVALID_REQUEST` (wrong password), `404 NOT_FOUND` (the flow has
ended), `429 RATE_LIMITED`.

### `GET /api/auth/me`

Public. Returns nulls when signed out. When signed in, it returns the user,
their storage registration and a light storage health snapshot. The snapshot
reads the cached connection state and makes no Telegram round-trip, so it is
fast.

**Query parameters** — none. The route reads the session cookie only, not a
bearer token.

**Request**

```bash
curl -sS https://omnicloud.example.com/api/auth/me \
  -H "Cookie: omnicloud_session=$SESSION"
```

**Response** `200`, signed in

```json
{
  "user": {
    "id": "tz4a98xxat96iws9zmbrgj3a",
    "username": "jane",
    "firstName": "Jane",
    "lastName": null
  },
  "storage": {
    "id": "tz4a98xxat96iws9zmbrgj3b",
    "provider": "telegram",
    "title": "OmniCloud Storage",
    "createdAt": "2026-08-01T10:00:00.000Z"
  },
  "health": {
    "provider": "telegram",
    "state": "CONNECTED",
    "status": "healthy",
    "latencyMs": null,
    "message": null,
    "channelTitle": "OmniCloud Storage",
    "checkedAt": "2026-08-01T10:00:05.000Z"
  }
}
```

**Response** `200`, signed out

```json
{ "user": null, "storage": null, "health": null }
```

If `user` is set but `storage` is `null`, the account has no storage channel
yet: call `POST /api/storage/ensure`.

### `POST /api/auth/logout`

Revokes the current browser session, drops the server-side Telegram connection
for that user and clears the cookie. It does **not** revoke the Telegram
session itself; that is done from Telegram Settings → Devices.

**Body** — none.

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/auth/logout \
  -H "Cookie: omnicloud_session=$SESSION"
```

**Response** `200`

```json
{ "ok": true }
```

### `POST /api/auth/logout-all`

Revokes every browser session for the account and clears the cookie. API tokens
are not affected: revoke those through `DELETE /api/tokens/:id`.

**Body** — none.

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/auth/logout-all \
  -H "Cookie: omnicloud_session=$SESSION"
```

**Response** `200`

```json
{ "ok": true, "revoked": 3 }
```

`revoked` is the number of sessions the server revoked.

**Errors**: `401 AUTH_REQUIRED` when no session cookie is present.

### `GET /api/auth/recovery`

Reads the stored OCE1 recovery blob. The blob is opaque ciphertext: the
server stores and returns it without ever being able to open it.

**Query parameters** — none.

**Request**

```bash
curl -sS https://omnicloud.example.com/api/auth/recovery \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200`

```json
{ "recoveryBlob": "3q2+7w==" }
```

**Response** `200`, nothing stored yet

```json
{ "recoveryBlob": null }
```

**Errors**: `401 AUTH_REQUIRED` when neither a session cookie nor a valid
bearer token is present.

### `PUT /api/auth/recovery`

Stores the OCE1 recovery blob for the signed-in user, replacing any previous
one.

**Body**

| Field          | Type   | Required | Notes                                                                                                   |
| -------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------- |
| `recoveryBlob` | string | yes      | Base64 encoding exactly 72 bytes: a 24-byte nonce, a 32-byte sealed user recovery key and a 16-byte tag |

**Request**

```bash
curl -sS -X PUT https://omnicloud.example.com/api/auth/recovery \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"recoveryBlob": "3q2+7w=="}'
```

**Response** `200`

```json
{ "status": "ok" }
```

**Errors**

| Status | Code              | Cause                                                  |
| ------ | ----------------- | ------------------------------------------------------ |
| 400    | `INVALID_REQUEST` | The blob is not base64, or does not decode to 72 bytes |
| 401    | `AUTH_REQUIRED`   | No session cookie and no valid bearer token            |

### `DELETE /api/auth/recovery`

Clears the stored recovery blob.

**Body** — none.

**Request**

```bash
curl -sS -X DELETE https://omnicloud.example.com/api/auth/recovery \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200`

```json
{ "status": "ok" }
```

**Errors**: `401 AUTH_REQUIRED`.

---

## Storage

Every storage route needs a session cookie or an API token.

| Endpoint                                 | Method | Purpose                                            |
| ---------------------------------------- | ------ | -------------------------------------------------- |
| `POST /api/storage/ensure`               | POST   | Create the storage channel if it is missing        |
| `GET /api/storage/health`                | GET    | Storage health plus statistics                     |
| `POST /api/storage/health/check`         | POST   | Probe the connection, optionally deeply            |
| `GET /api/storage/stats`                 | GET    | Dashboard statistics                               |
| `POST /api/storage/reconciliation`       | POST   | Read-only comparison of channel and database       |
| `POST /api/storage/reconciliation/plan`  | POST   | Actions a repair could apply                       |
| `POST /api/storage/reconciliation/apply` | POST   | Apply the approved repairs                         |
| `POST /api/storage/integrity/check`      | POST   | Read-only drift check between metadata and storage |

### `POST /api/storage/ensure`

Creates the user's private Telegram storage channel if it does not exist yet.
It is idempotent: calling it again returns the existing record.

**Body** — none.

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/storage/ensure \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200`

```json
{
  "storage": {
    "id": "tz4a98xxat96iws9zmbrgj3b",
    "provider": "telegram",
    "title": "OmniCloud Storage",
    "createdAt": "2026-08-01T10:00:00.000Z"
  }
}
```

**Errors**: `409 STORAGE_NOT_INITIALIZED`, `401 TELEGRAM_AUTH_REQUIRED`,
`502 TELEGRAM_CONNECTION_FAILED`, `403 PERMISSION_DENIED` (the account cannot
write to the channel).

### `GET /api/storage/health`

Returns the current storage health and the statistics snapshot in one call.

**Query parameters** — none.

**Request**

```bash
curl -sS https://omnicloud.example.com/api/storage/health \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200`

```json
{
  "health": {
    "provider": "telegram",
    "state": "CONNECTED",
    "status": "healthy",
    "latencyMs": null,
    "message": null,
    "channelTitle": "OmniCloud Storage",
    "checkedAt": "2026-08-01T10:00:05.000Z"
  },
  "stats": {
    "fileCount": 42,
    "folderCount": 7,
    "totalBytes": 734003200,
    "trashBytes": 1048576,
    "trashFileCount": 2,
    "starredCount": 5,
    "byType": [{ "category": "image", "bytes": 524288000, "count": 20 }],
    "largestFiles": [],
    "quotaBytes": null
  }
}
```

`state` is one of `DISCONNECTED`, `CONNECTING`, `CONNECTED`, `RECONNECTING`,
`ERROR`, `AUTH_REQUIRED`. `status` is `healthy`, `degraded`, `unavailable` or
`unknown`.

### `POST /api/storage/health/check`

Forces a fresh probe of the connection.

**Body**

| Field  | Type    | Required | Notes                                                       |
| ------ | ------- | -------- | ----------------------------------------------------------- |
| `deep` | boolean | no       | Default `false`. `true` performs a real Telegram round-trip |

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/storage/health/check \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"deep": true}'
```

**Response** `200`

```json
{
  "health": {
    "provider": "telegram",
    "state": "CONNECTED",
    "status": "healthy",
    "latencyMs": 84,
    "message": null,
    "channelTitle": "OmniCloud Storage",
    "checkedAt": "2026-08-01T10:00:05.000Z"
  }
}
```

A shallow probe reuses the last result for 30 seconds.

### `GET /api/storage/stats`

Computes the dashboard statistics from PostgreSQL metadata only. No Telegram
round-trip happens, so it works while Telegram is unreachable.

**Query parameters** — none.

**Request**

```bash
curl -sS https://omnicloud.example.com/api/storage/stats \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200`

```json
{
  "stats": {
    "fileCount": 42,
    "folderCount": 7,
    "totalBytes": 734003200,
    "trashBytes": 1048576,
    "trashFileCount": 2,
    "starredCount": 5,
    "byType": [
      { "category": "image", "bytes": 524288000, "count": 20 },
      { "category": "video", "bytes": 200000000, "count": 3 }
    ],
    "largestFiles": [],
    "quotaBytes": null
  }
}
```

`byType` uses the coarse categories from `fileCategory()` and is sorted by
bytes descending. `largestFiles` holds at most 10 files, largest first.
`quotaBytes` is `null` unless `STORAGE_QUOTA_GB` is set.

### `POST /api/storage/reconciliation`

Read-only comparison of the storage channel with OmniCloud's records. It
lists the objects in the channel and reports:

- `unknown` — an object exists in the channel that no file, version or
  in-flight upload references. It may be a leaked upload, or something you
  stored yourself. It is **reported only**: nothing is deleted.
- `dangling` — a record points at an object that is no longer in the channel.

**Body**

| Field   | Type    | Required | Notes                                                                      |
| ------- | ------- | -------- | -------------------------------------------------------------------------- |
| `limit` | integer | no       | How many channel messages to read. Positive; capped at 20000. Default 5000 |

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/storage/reconciliation \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"limit": 5000}'
```

**Response** `200`

```json
{
  "report": {
    "scannedMessages": 42,
    "referencedMessages": 40,
    "limit": 5000,
    "truncated": false,
    "unknown": [{ "kind": "unknown", "messageId": 9001, "sizeBytes": 1024 }],
    "dangling": []
  }
}
```

`truncated` is `true` when the channel listing reached the cap, so older
messages were not read and the report is partial.

### `POST /api/storage/reconciliation/plan`

Reruns the scan and returns the actions that could be approved. It changes
nothing.

**Body** — none.

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/storage/reconciliation/plan \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200`

```json
{
  "plan": {
    "actions": [
      {
        "id": "adopt-9001",
        "kind": "adopt-unknown",
        "messageId": 9001,
        "sizeBytes": 1024,
        "reason": "A channel message has no record. Adopting creates a file record for it. The message is not removed.",
        "destructive": false
      }
    ],
    "deletions": []
  }
}
```

The two action kinds, neither destructive:

| `kind`            | Effect                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `detach-dangling` | Marks a record whose channel message is gone. The record is not deleted                                                |
| `adopt-unknown`   | Creates a file record for a channel message that has none, using the object's real SHA-256. The message is not removed |

`deletions` is always empty: a message in your channel is never deleted. It
may be something you stored yourself, and OmniCloud cannot prove it owns it.

### `POST /api/storage/reconciliation/apply`

Applies only the approved actions. The scan is rerun first, so a plan made
against an older channel cannot be applied to a changed one. Nothing is deleted
at the storage provider.

**Body**

| Field         | Type     | Required | Notes                                                   |
| ------------- | -------- | -------- | ------------------------------------------------------- |
| `approvedIds` | string[] | yes      | Action ids from the plan. May be empty. At most 200 ids |

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/storage/reconciliation/apply \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"approvedIds": ["adopt-9001"]}'
```

**Response** `200`

```json
{
  "result": {
    "applied": [{ "id": "adopt-9001", "kind": "adopt-unknown" }],
    "failed": []
  }
}
```

**Errors**: `400 INVALID_REQUEST` when an id the fresh plan does not offer is
approved, or when more than 200 ids are sent.

### `POST /api/storage/integrity/check`

Read-only drift check between PostgreSQL metadata and the storage channel.

**Body**

| Field  | Type    | Required | Notes                                                           |
| ------ | ------- | -------- | --------------------------------------------------------------- |
| `deep` | boolean | no       | Default `false`. `true` re-downloads and re-hashes every object |

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/storage/integrity/check \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"deep": false}'
```

**Response** `200`

```json
{
  "report": {
    "checkedAt": "2026-08-01T10:01:00.000Z",
    "filesChecked": 40,
    "healthy": 38,
    "missing": 1,
    "inconsistent": 1,
    "unreadable": 0,
    "issues": [
      {
        "fileId": "tz4a98xxat96iws9zmbrgj3a",
        "name": "report.pdf",
        "kind": "missing",
        "detail": "No message with this id exists in the storage channel"
      },
      {
        "fileId": "tz4a98xxat96iws9zmbrgj3c",
        "name": "archive.zip",
        "kind": "size_mismatch",
        "detail": "metadata=1048576 storage=0"
      }
    ],
    "durationMs": 812
  }
}
```

Issue kinds:

| Kind            | Meaning                                                          |
| --------------- | ---------------------------------------------------------------- |
| `missing`       | Metadata exists, the channel message is gone                     |
| `size_mismatch` | The stored object's size differs from the metadata               |
| `hash_mismatch` | Deep mode only: downloaded bytes do not match the stored SHA-256 |
| `unreadable`    | The provider errored while inspecting the object                 |

An issue about a historical version carries a `versionId`, so a missing old
version is reported against that version rather than hidden behind the current
file. The checker never repairs, deletes or rewrites anything.

---

## Files

Files are the stored objects. Their bytes live in the user's Telegram channel;
PostgreSQL holds the logical record.

| Endpoint                                          | Method | Purpose                            |
| ------------------------------------------------- | ------ | ---------------------------------- |
| `POST /api/files`                                 | POST   | Upload a file                      |
| `GET /api/files`                                  | GET    | List and filter files              |
| `POST /api/files/batch`                           | POST   | Apply one operation to many files  |
| `GET /api/files/:id`                              | GET    | File metadata                      |
| `GET /api/files/:id/versions`                     | GET    | Version history                    |
| `POST /api/files/:id/versions/prune`              | POST   | Remove old versions under a policy |
| `POST /api/files/:id/versions/:versionId/restore` | POST   | Make an earlier version current    |
| `DELETE /api/files/:id/versions/:versionId`       | DELETE | Remove one historical version      |
| `POST /api/files/:id/replace`                     | POST   | Upload a new version               |
| `GET /api/files/:id/download`                     | GET    | Stream the bytes                   |
| `PATCH /api/files/:id`                            | PATCH  | Rename and/or star                 |
| `POST /api/files/:id/move`                        | POST   | Move into a folder                 |
| `POST /api/files/:id/trash`                       | POST   | Move to the Trash                  |
| `POST /api/files/:id/restore`                     | POST   | Restore from the Trash             |
| `DELETE /api/files/:id`                           | DELETE | Delete permanently                 |

### The file object

Every file response carries the same shape (`FileDTO` in
`packages/shared/src/index.ts`):

| Field              | Type           | Notes                                                       |
| ------------------ | -------------- | ----------------------------------------------------------- |
| `id`               | string         | File id                                                     |
| `name`             | string         | The name as the server knows it                             |
| `size`             | number         | Byte length of the current version                          |
| `mimeType`         | string         | Derived server-side from the filename extension             |
| `sha256`           | string         | Checksum of the current version's bytes                     |
| `folderId`         | string \| null | `null` means the root                                       |
| `starred`          | boolean        |                                                             |
| `trashed`          | boolean        | `true` when `deletedAt` is set                              |
| `deletedAt`        | string \| null | ISO-8601 timestamp of the trash operation                   |
| `versionCount`     | number         | Number of stored versions                                   |
| `currentVersionId` | string \| null | The version `GET /api/files/:id/download` serves            |
| `encryptionFormat` | string \| null | `"OCE1"`, `"OCE2"` or `null` for a plaintext file           |
| `wrappedKey`       | string \| null | Base64. The key that unwraps the current version's data key |
| `metadataBlob`     | string \| null | Base64. The encrypted metadata, which carries the real name |
| `keyEpoch`         | number \| null | Key epoch, `0`–`4294967295`                                 |
| `createdAt`        | string         | ISO-8601 timestamp                                          |
| `updatedAt`        | string         | ISO-8601 timestamp                                          |

> The four encryption fields describe the **current version only**. They are
> `null` for a plaintext file, and they are always present in a file response
> (as `null`), so a client can branch on `encryptionFormat` alone.

### `POST /api/files`

Uploads a file. The body is `multipart/form-data`.

**Parts**

| Part               | Type       | Required        | Notes                                                               |
| ------------------ | ---------- | --------------- | ------------------------------------------------------------------- |
| `file`             | file       | yes             | Exactly one file part. The multipart filename becomes the file name |
| `folderId`         | text field | no              | Target folder id. Empty or absent means the root                    |
| `operationId`      | text field | no              | Idempotency key, 8–64 characters `[A-Za-z0-9_-]`                    |
| `encryptionFormat` | text field | with encryption | `"OCE1"` or `"OCE2"`                                                |
| `wrappedKey`       | text field | with encryption | Base64, 56–4096 characters                                          |
| `metadataBlob`     | text field | with encryption | Base64, 56–65536 characters                                         |
| `keyEpoch`         | text field | with encryption | Integer `0`–`4294967295`                                            |

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/files \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@report.pdf" \
  -F "folderId=tz4a98xxat96iws9zmbrgj3d" \
  -F "operationId=upload-report-001"
```

**Response** `201`

```json
{
  "file": {
    "id": "tz4a98xxat96iws9zmbrgj3a",
    "name": "report.pdf",
    "size": 1048576,
    "mimeType": "application/pdf",
    "sha256": "8e1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c",
    "folderId": "tz4a98xxat96iws9zmbrgj3d",
    "starred": false,
    "trashed": false,
    "deletedAt": null,
    "versionCount": 1,
    "currentVersionId": "tz4a98xxat96iws9zmbrgj3e",
    "encryptionFormat": null,
    "wrappedKey": null,
    "metadataBlob": null,
    "keyEpoch": null,
    "createdAt": "2026-08-01T10:00:00.000Z",
    "updatedAt": "2026-08-01T10:00:00.000Z"
  }
}
```

**Encrypted upload.** A client that encrypts before uploading adds the four
encryption parts. All four must be present together, or all absent; a partial
set is rejected with `400 INVALID_REQUEST`.

```bash
curl -sS -X POST https://omnicloud.example.com/api/files \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@report.pdf.enc" \
  -F "encryptionFormat=OCE1" \
  -F "wrappedKey=$WRAPPED_KEY" \
  -F "metadataBlob=$METADATA_BLOB" \
  -F "keyEpoch=0"
```

The response then carries the four fields:

```json
{
  "file": {
    "id": "tz4a98xxat96iws9zmbrgj3a",
    "name": "report.pdf.enc",
    "size": 1048576,
    "mimeType": "application/octet-stream",
    "sha256": "8e1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c",
    "folderId": null,
    "starred": false,
    "trashed": false,
    "deletedAt": null,
    "versionCount": 1,
    "currentVersionId": "tz4a98xxat96iws9zmbrgj3e",
    "encryptionFormat": "OCE1",
    "wrappedKey": "QUFBQUFBQUE=",
    "metadataBlob": "QkJCQkJCQkJC",
    "keyEpoch": 0,
    "createdAt": "2026-08-01T10:00:00.000Z",
    "updatedAt": "2026-08-01T10:00:00.000Z"
  }
}
```

What the server does with the four fields, and what it does not:

- The server checks that all four are present, that `encryptionFormat` is
  `OCE1` or `OCE2`, that `wrappedKey` and `metadataBlob` are base64 of a
  plausible length, and that `keyEpoch` is an integer in range. It never
  interprets the envelope.
- `OCE1` encrypts the content and the metadata. The file's **name stays
  visible to the server**: the multipart filename is stored in `File.name`,
  and the MIME type is derived from it.
- `OCE2` also hides the name. The multipart filename must then be an opaque
  placeholder (`om_` followed by 32 lowercase hex characters), and the server
  rejects the upload otherwise, so a client cannot claim OCE2 and hand the
  server the real name. The MIME type is derived from the placeholder.
- The format is recorded on the file and on each version, and reported in
  `encryptionFormat`.

> The server **cannot decrypt** a client-encrypted file. It stores and returns
> opaque ciphertext, and only the client holds the key. Encrypted upload is
> opt-in and the implementation has not been independently reviewed.

**Retrying an upload.** Send the same `Idempotency-Key` header or
`operationId` field on a retry. If the first request succeeded, the retry
returns the original file and no second copy is stored. Reusing a key for
different bytes returns `409 CONFLICT`; use a new key for a new upload. Keys
are scoped to the account.

**Errors**

| Status | Code                | Cause                                                          |
| ------ | ------------------- | -------------------------------------------------------------- |
| 400    | `INVALID_REQUEST`   | No `file` part, no filename, or a partial encryption field set |
| 400    | `INVALID_REQUEST`   | An OCE2 upload that does not use an opaque name                |
| 404    | `FOLDER_NOT_FOUND`  | The target folder does not exist                               |
| 409    | `CONFLICT`          | The target folder is in the Trash                              |
| 409    | `CONFLICT`          | The idempotency key was already used for different bytes       |
| 413    | `PAYLOAD_TOO_LARGE` | The file exceeds `MAX_UPLOAD_MB`                               |
| 502    | `UPLOAD_FAILED`     | The storage provider refused or failed the upload              |

Notes: the multipart limit is 1 file and 10 parts. The MIME type is derived
server-side from the filename extension, and a client-supplied MIME type is
ignored. Every upload creates version 1, so `versionCount` is `1` and
`currentVersionId` is set immediately. Metadata is persisted only after the
channel upload succeeds. The provider additionally rejects documents above
Telegram's 2 GB limit with `502 UPLOAD_FAILED`.

### `GET /api/files`

Lists and filters files. It reads the shared
[pagination, sorting and filtering](#sorting-and-filtering) parameters.

**Query parameters**

| Parameter                                                         | Notes                                                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `folderId`                                                        | Scopes to a folder. **Presence matters**: omit it to span every folder; send it empty (`folderId=`) to scope to the root |
| `page`, `limit`, `sort`, `order`                                  | See [sorting and filtering](#sorting-and-filtering)                                                                      |
| `status`                                                          | Default `active`. Pass `status=trashed` for trashed files, `status=all` for both                                         |
| `q`, `type`, `ext`, `starred`, `minSize`, `maxSize`, `from`, `to` | See [sorting and filtering](#sorting-and-filtering)                                                                      |

**Request**

```bash
curl -sS "https://omnicloud.example.com/api/files?folderId=&type=pdf&limit=2" \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200`

```json
{
  "files": [
    {
      "id": "tz4a98xxat96iws9zmbrgj3a",
      "name": "report.pdf",
      "size": 1048576,
      "mimeType": "application/pdf",
      "sha256": "8e1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c",
      "folderId": null,
      "starred": false,
      "trashed": false,
      "deletedAt": null,
      "versionCount": 1,
      "currentVersionId": "tz4a98xxat96iws9zmbrgj3e",
      "encryptionFormat": null,
      "wrappedKey": null,
      "metadataBlob": null,
      "keyEpoch": null,
      "createdAt": "2026-08-01T10:00:00.000Z",
      "updatedAt": "2026-08-01T10:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 2, "total": 1, "hasMore": false }
}
```

### `POST /api/files/batch`

Applies one operation to many files.

**Body**

| Field         | Type           | Required | Notes                                                        |
| ------------- | -------------- | -------- | ------------------------------------------------------------ |
| `operation`   | string         | yes      | `trash`, `restore`, `delete`, `star`, `unstar` or `move`     |
| `ids`         | string[]       | yes      | 1–500 unique, non-empty ids                                  |
| `folderId`    | string \| null | no       | Only for `move`: the destination, `null` means the root      |
| `operationId` | string         | no       | 8–64 characters `[A-Za-z0-9_-]`, echoed back in the response |

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/files/batch \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"operation": "move", "ids": ["tz4a98xxat96iws9zmbrgj3a"], "folderId": null}'
```

**Response** `200`

```json
{
  "operationId": "batch-2026-08-01",
  "requested": 1,
  "succeeded": 1,
  "failed": 0,
  "errors": []
}
```

A `move` with an invalid target folder fails the whole batch with
`404 FOLDER_NOT_FOUND` or `409 CONFLICT`. Other per-item failures are listed in
`errors`.

### `GET /api/files/:id`

Returns the metadata of one file.

**Path parameters**

| Parameter | Type   | Required | Notes       |
| --------- | ------ | -------- | ----------- |
| `id`      | string | yes      | The file id |

**Request**

```bash
curl -sS https://omnicloud.example.com/api/files/tz4a98xxat96iws9zmbrgj3a \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200`

```json
{
  "file": {
    "id": "tz4a98xxat96iws9zmbrgj3a",
    "name": "report.pdf",
    "size": 1048576,
    "mimeType": "application/pdf",
    "sha256": "8e1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c",
    "folderId": null,
    "starred": false,
    "trashed": false,
    "deletedAt": null,
    "versionCount": 2,
    "currentVersionId": "tz4a98xxat96iws9zmbrgj3e",
    "encryptionFormat": null,
    "wrappedKey": null,
    "metadataBlob": null,
    "keyEpoch": null,
    "createdAt": "2026-08-01T10:00:00.000Z",
    "updatedAt": "2026-08-02T09:00:00.000Z"
  }
}
```

**Errors**: `404 FILE_NOT_FOUND` when the file does not exist, is owned by
another user, or does not belong to the caller. A trashed file is still
returned here.

### `GET /api/files/:id/versions`

Returns the file's version history, newest first.

**Path parameters**

| Parameter | Type   | Required | Notes       |
| --------- | ------ | -------- | ----------- |
| `id`      | string | yes      | The file id |

**Request**

```bash
curl -sS https://omnicloud.example.com/api/files/tz4a98xxat96iws9zmbrgj3a/versions \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200`

```json
{
  "versions": [
    {
      "id": "tz4a98xxat96iws9zmbrgj3e",
      "fileId": "tz4a98xxat96iws9zmbrgj3a",
      "versionNumber": 2,
      "size": 2097152,
      "mimeType": "application/pdf",
      "sha256": "91ab34cd56ef78ab90cd12ef34ab56cd78ef90ab12cd34ef56ab78cd90ef12ab34",
      "telegramMessageId": 4021,
      "isCurrent": true,
      "encryptionFormat": null,
      "wrappedKey": null,
      "metadataBlob": null,
      "keyEpoch": null,
      "createdAt": "2026-08-02T09:00:00.000Z"
    }
  ]
}
```

`isCurrent` is true for the file's `currentVersionId`. Each version carries the
same four encryption fields as the file; they describe that version, not the
file.

**Errors**: `404 FILE_NOT_FOUND`.

### `POST /api/files/:id/versions/prune`

Removes old versions under a policy you name. Nothing is pruned unless you
call this, and the current version is never removed. Each version's channel
message is deleted before its record, so a failed remote delete keeps that
version.

**Body**

| Field    | Type    | Required            | Notes                                          |
| -------- | ------- | ------------------- | ---------------------------------------------- |
| `policy` | string  | yes                 | `KEEP_ALL`, `KEEP_LATEST_N` or `KEEP_FOR_DAYS` |
| `count`  | integer | for `KEEP_LATEST_N` | Whole number ≥ 0                               |
| `days`   | integer | for `KEEP_FOR_DAYS` | Whole number ≥ 1                               |

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/files/tz4a98xxat96iws9zmbrgj3a/versions/prune \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"policy": "KEEP_LATEST_N", "count": 2}'
```

**Response** `200`

```json
{ "removed": 1 }
```

**Errors**: `400 INVALID_REQUEST` (unknown policy, or a missing or invalid
`count`/`days`), `404 FILE_NOT_FOUND`.

### `POST /api/files/:id/versions/:versionId/restore`

Makes an earlier version the current one again.

**Path parameters**

| Parameter   | Type   | Required | Notes          |
| ----------- | ------ | -------- | -------------- |
| `id`        | string | yes      | The file id    |
| `versionId` | string | yes      | The version id |

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/files/tz4a98xxat96iws9zmbrgj3a/versions/tz4a98xxat96iws9zmbrgj30/restore \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200`

```json
{
  "file": {
    "id": "tz4a98xxat96iws9zmbrgj3a",
    "name": "report.pdf",
    "size": 1048576,
    "mimeType": "application/pdf",
    "sha256": "8e1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c",
    "folderId": null,
    "starred": false,
    "trashed": false,
    "deletedAt": null,
    "versionCount": 2,
    "currentVersionId": "tz4a98xxat96iws9zmbrgj30",
    "encryptionFormat": null,
    "wrappedKey": null,
    "metadataBlob": null,
    "keyEpoch": null,
    "createdAt": "2026-08-01T10:00:00.000Z",
    "updatedAt": "2026-08-02T09:05:00.000Z"
  }
}
```

The file is pointed back at the version that already exists; nothing is
re-uploaded. That is required, not an optimisation: the OCE1 record
authentication binds the version id, so a copy of an old version's ciphertext
under a new id could never be decrypted.

The file's own name is unchanged, because a rename belongs to the file, not to
a version. For an encrypted file the restored version's own metadata blob comes
back with it, so the name embedded in that version's metadata is the one a
download will use.

**Errors**: `404 FILE_NOT_FOUND` (no such file or version, or the version
belongs to another file or user), `409 CONFLICT` (the version is already
current).

### `DELETE /api/files/:id/versions/:versionId`

Removes one historical version. The channel message is deleted first and the
record only after that, so a failed delete keeps the record for
reconciliation. Other versions are untouched.

The current version cannot be deleted: the file would have nothing to point at.
Restore another version first, or delete the file.

**Path parameters**

| Parameter   | Type   | Required | Notes          |
| ----------- | ------ | -------- | -------------- |
| `id`        | string | yes      | The file id    |
| `versionId` | string | yes      | The version id |

**Request**

```bash
curl -sS -X DELETE https://omnicloud.example.com/api/files/tz4a98xxat96iws9zmbrgj3a/versions/tz4a98xxat96iws9zmbrgj31 \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `204`, no body.

**Errors**: `404 FILE_NOT_FOUND`, `409 CONFLICT` (the version is the current
one), `502` (mapped provider error).

### `POST /api/files/:id/replace`

Uploads a new version of an existing file and makes it current. The body is
`multipart/form-data` with the same parts as `POST /api/files`; the
`folderId` part is ignored, because the file keeps its folder.

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/files/tz4a98xxat96iws9zmbrgj3a/replace \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@report-v2.pdf" \
  -F "operationId=replace-report-002"
```

**Response** `200`

```json
{
  "file": {
    "id": "tz4a98xxat96iws9zmbrgj3a",
    "name": "report-v2.pdf",
    "size": 2097152,
    "mimeType": "application/pdf",
    "sha256": "91ab34cd56ef78ab90cd12ef34ab56cd78ef90ab12cd34ef56ab78cd90ef12ab34",
    "folderId": null,
    "starred": false,
    "trashed": false,
    "deletedAt": null,
    "versionCount": 2,
    "currentVersionId": "tz4a98xxat96iws9zmbrgj32",
    "encryptionFormat": null,
    "wrappedKey": null,
    "metadataBlob": null,
    "keyEpoch": null,
    "createdAt": "2026-08-01T10:00:00.000Z",
    "updatedAt": "2026-08-02T09:00:00.000Z"
  }
}
```

A replace with no encryption fields clears the file's encryption fields, so
the file describes its current version only.

**Errors**: `404 FILE_NOT_FOUND`, `413 PAYLOAD_TOO_LARGE`,
`502 UPLOAD_FAILED`.

### `GET /api/files/:id/download`

Streams the bytes of the current version straight from the channel to the
client. Only **active** files can be downloaded; a trashed file returns
`404 FILE_NOT_FOUND`.

**Path parameters**

| Parameter | Type   | Required | Notes       |
| --------- | ------ | -------- | ----------- |
| `id`      | string | yes      | The file id |

**Request**

```bash
curl -sS https://omnicloud.example.com/api/files/tz4a98xxat96iws9zmbrgj3a/download \
  -H "Authorization: Bearer $TOKEN" \
  -o report.pdf
```

**Response** `200`, with headers

| Header                | Value                                                                       |
| --------------------- | --------------------------------------------------------------------------- |
| `Content-Type`        | The stored MIME type                                                        |
| `Content-Length`      | Byte length                                                                 |
| `Content-Disposition` | `attachment` with an ASCII name and an RFC 5987 (`filename*=UTF-8''…`) form |
| `X-Content-SHA256`    | The stored SHA-256                                                          |

The body is the raw file bytes.

The stream is verified against the stored SHA-256 as it flows, and the final
bytes are withheld until the checksum matches. A corrupt object therefore ends
the response with a broken connection, not a complete body. Clients must treat
an incomplete transfer (fewer bytes than `Content-Length`, or a connection
error) as a failed download.

> For a client-encrypted file, the bytes are ciphertext. The server cannot
> decrypt them; the client must decrypt after downloading.

The `X-Integrity-Verified` header was removed in v0.2.2: it can no longer be
known before the body is sent.

**Errors**: `404 FILE_NOT_FOUND`, `502 UPLOAD_FAILED`,
`401 TELEGRAM_AUTH_REQUIRED`.

> A storage-layer failure during a download is reported as `UPLOAD_FAILED`
> (502), because the storage engine wraps every provider error in the same
> `UploadFailedError`. The message still says "Download failed". A dedicated
> `DOWNLOAD_FAILED` code exists in `packages/core/src/errors.ts` but is not
> exported and is never thrown.

### `PATCH /api/files/:id`

Renames and/or stars a file. At least one of `name` or `starred` is required.

**Body**

| Field          | Type    | Required | Notes                                                                               |
| -------------- | ------- | -------- | ----------------------------------------------------------------------------------- |
| `name`         | string  | no       | The new name. Path components are dropped and the name is trimmed to 255 characters |
| `starred`      | boolean | no       | Whether the file is starred. `"true"` and `"false"` are accepted as strings         |
| `metadataBlob` | string  | no       | Base64, 56–65536 characters. The re-encrypted metadata of an encrypted file         |

**Request**

```bash
curl -sS -X PATCH https://omnicloud.example.com/api/files/tz4a98xxat96iws9zmbrgj3a \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "renamed.pdf", "starred": true}'
```

**Response** `200`

```json
{
  "file": {
    "id": "tz4a98xxat96iws9zmbrgj3a",
    "name": "renamed.pdf",
    "size": 1048576,
    "mimeType": "application/pdf",
    "sha256": "8e1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c",
    "folderId": null,
    "starred": true,
    "trashed": false,
    "deletedAt": null,
    "versionCount": 1,
    "currentVersionId": "tz4a98xxat96iws9zmbrgj3e",
    "encryptionFormat": null,
    "wrappedKey": null,
    "metadataBlob": null,
    "keyEpoch": null,
    "createdAt": "2026-08-01T10:00:00.000Z",
    "updatedAt": "2026-08-02T10:00:00.000Z"
  }
}
```

`metadataBlob` is how an encrypted file's name is changed: the name lives
inside the metadata blob, so the client re-encrypts it and sends the new blob
with the rename. The server stores it without interpreting it. A file that is
not encrypted does not need it.

**Errors**: `400 INVALID_REQUEST` (neither field, an invalid name, or a
malformed `metadataBlob`), `404 FILE_NOT_FOUND`.

### `POST /api/files/:id/move`

Moves a file into a folder, or to the root with `null`.

**Body**

| Field      | Type           | Required | Notes                                          |
| ---------- | -------------- | -------- | ---------------------------------------------- |
| `folderId` | string \| null | yes      | The destination folder id, `null` for the root |

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/files/tz4a98xxat96iws9zmbrgj3a/move \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"folderId": "tz4a98xxat96iws9zmbrgj3d"}'
```

**Response** `200` — the file object, with the new `folderId`.

**Errors**: `400 INVALID_REQUEST`, `404 FILE_NOT_FOUND`, `404 FOLDER_NOT_FOUND`,
`409 CONFLICT` (the target folder is in the Trash).

### `POST /api/files/:id/trash`

Moves a file to the Trash. The channel object is untouched, so a restore is
lossless. It is idempotent: re-trashing returns the record unchanged.

**Body** — none.

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/files/tz4a98xxat96iws9zmbrgj3a/trash \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200`

```json
{
  "file": {
    "id": "tz4a98xxat96iws9zmbrgj3a",
    "name": "report.pdf",
    "size": 1048576,
    "mimeType": "application/pdf",
    "sha256": "8e1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c",
    "folderId": null,
    "starred": false,
    "trashed": true,
    "deletedAt": "2026-08-03T12:00:00.000Z",
    "versionCount": 1,
    "currentVersionId": "tz4a98xxat96iws9zmbrgj3e",
    "encryptionFormat": null,
    "wrappedKey": null,
    "metadataBlob": null,
    "keyEpoch": null,
    "createdAt": "2026-08-01T10:00:00.000Z",
    "updatedAt": "2026-08-03T12:00:00.000Z"
  }
}
```

**Errors**: `404 FILE_NOT_FOUND`.

### `POST /api/files/:id/restore`

Restores a trashed file. If its original folder is gone or itself trashed, the
file is restored to the root, so a restore can never produce an orphan.

**Body** — none.

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/files/tz4a98xxat96iws9zmbrgj3a/restore \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200` — the file object, with `trashed: false` and `deletedAt: null`.

**Errors**: `404 FILE_NOT_FOUND`.

### `DELETE /api/files/:id`

**Permanently deletes** the file: every channel message it owns, current and
historical, is removed first, then the metadata. If a remote delete fails, the
metadata is kept so the operation can be retried.

**Body** — none.

**Request**

```bash
curl -sS -X DELETE https://omnicloud.example.com/api/files/tz4a98xxat96iws9zmbrgj3a \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `204`, no body.

> This is a permanent operation. Use `POST /api/files/:id/trash` first if you
> want a recoverable step.

**Errors**: `404 FILE_NOT_FOUND`, `502` (mapped provider error),
`401 TELEGRAM_AUTH_REQUIRED`.

---

## Folders

Folders are virtual OmniCloud objects with a parent-child hierarchy. They have
no physical representation in the channel.

| Endpoint                        | Method | Purpose                             |
| ------------------------------- | ------ | ----------------------------------- |
| `POST /api/folders`             | POST   | Create a folder                     |
| `GET /api/folders`              | GET    | List folders                        |
| `GET /api/folders/tree`         | GET    | Every active folder, flat           |
| `POST /api/folders/batch`       | POST   | Apply one operation to many folders |
| `PATCH /api/folders/:id`        | PATCH  | Rename and/or star                  |
| `POST /api/folders/:id/move`    | POST   | Move under a new parent             |
| `POST /api/folders/:id/trash`   | POST   | Move the subtree to the Trash       |
| `POST /api/folders/:id/restore` | POST   | Restore the subtree                 |
| `DELETE /api/folders/:id`       | DELETE | Delete the subtree permanently      |

### The folder object

| Field       | Type           | Notes                          |
| ----------- | -------------- | ------------------------------ |
| `id`        | string         |                                |
| `name`      | string         |                                |
| `parentId`  | string \| null | `null` means the root          |
| `starred`   | boolean        |                                |
| `trashed`   | boolean        | `true` when `deletedAt` is set |
| `deletedAt` | string \| null | ISO-8601 timestamp             |
| `createdAt` | string         | ISO-8601 timestamp             |
| `updatedAt` | string         | ISO-8601 timestamp             |

### `POST /api/folders`

Creates a folder.

**Body**

| Field      | Type           | Required | Notes                                               |
| ---------- | -------------- | -------- | --------------------------------------------------- |
| `name`     | string         | yes      | The folder name                                     |
| `parentId` | string \| null | no       | The parent folder id. Defaults to `null` (the root) |

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/folders \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Documents", "parentId": null}'
```

**Response** `201`

```json
{
  "folder": {
    "id": "tz4a98xxat96iws9zmbrgj3d",
    "name": "Documents",
    "parentId": null,
    "starred": false,
    "trashed": false,
    "deletedAt": null,
    "createdAt": "2026-08-01T10:00:00.000Z",
    "updatedAt": "2026-08-01T10:00:00.000Z"
  }
}
```

**Errors**: `400 INVALID_REQUEST` (missing or invalid name), `404
FOLDER_NOT_FOUND` (invalid parent), `409 CONFLICT` (the parent is in the
Trash).

### `GET /api/folders`

Lists folders. The route has two modes, and the switch is decided by which
query parameters are present.

**Mode 1 — no scope filter.** When `parentId`, `status`, `q` and `starred` are
all absent, the route returns the direct active children of the root. The
pagination envelope then describes that list: `page` is `1`, `limit` and
`total` both equal the number of folders, and `hasMore` is `false`. In this
mode `page` and `limit` are ignored, because the whole list is returned.

**Mode 2 — filtered.** As soon as one of `parentId`, `status`, `q` or `starred`
is present, the shared [pagination, sorting and filtering](#sorting-and-filtering)
parameters apply, and `parentId` scopes the result to one parent. An empty
`parentId` means the root; omitting it spans every folder. In this mode
`folderId` also works as an alias for the parent scope; in mode 1 it is
ignored.

**Query parameters**

| Parameter                        | Notes                                                         |
| -------------------------------- | ------------------------------------------------------------- |
| `parentId`                       | The scope. Empty means the root; omit it to span every folder |
| `status`                         | Default `active`                                              |
| `q`                              | Case-insensitive name substring                               |
| `starred`                        | `true`/`false`                                                |
| `page`, `limit`, `sort`, `order` | See [sorting and filtering](#sorting-and-filtering)           |

**Request**

```bash
curl -sS "https://omnicloud.example.com/api/folders?parentId=" \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200`

```json
{
  "folders": [
    {
      "id": "tz4a98xxat96iws9zmbrgj3d",
      "name": "Documents",
      "parentId": null,
      "starred": false,
      "trashed": false,
      "deletedAt": null,
      "createdAt": "2026-08-01T10:00:00.000Z",
      "updatedAt": "2026-08-01T10:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 1, "total": 1, "hasMore": false }
}
```

**Errors**: `404 FOLDER_NOT_FOUND` (invalid scope folder).

### `GET /api/folders/tree`

Returns every active folder of the user as a flat list. It is used by the move
dialogs.

**Query parameters** — none.

**Request**

```bash
curl -sS https://omnicloud.example.com/api/folders/tree \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200`

```json
{
  "folders": [
    {
      "id": "tz4a98xxat96iws9zmbrgj3d",
      "name": "Documents",
      "parentId": null,
      "starred": false,
      "trashed": false,
      "deletedAt": null,
      "createdAt": "2026-08-01T10:00:00.000Z",
      "updatedAt": "2026-08-01T10:00:00.000Z"
    }
  ]
}
```

There is no pagination, and trashed folders are excluded.

### `POST /api/folders/batch`

Same shape and semantics as the file batch endpoint, with `parentId` as the
move target.

**Body**

| Field       | Type           | Required | Notes                                                    |
| ----------- | -------------- | -------- | -------------------------------------------------------- |
| `operation` | string         | yes      | `trash`, `restore`, `delete`, `star`, `unstar` or `move` |
| `ids`       | string[]       | yes      | 1–500 unique, non-empty ids                              |
| `parentId`  | string \| null | no       | Only for `move`: the destination, `null` means the root  |

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/folders/batch \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"operation": "star", "ids": ["tz4a98xxat96iws9zmbrgj3d"]}'
```

**Response** `200`

```json
{
  "requested": 1,
  "succeeded": 1,
  "failed": 0,
  "errors": []
}
```

### `PATCH /api/folders/:id`

Renames and/or stars a folder. At least one of `name` or `starred` is required.

**Body**

| Field     | Type    | Required | Notes                                                      |
| --------- | ------- | -------- | ---------------------------------------------------------- |
| `name`    | string  | no       | The new name                                               |
| `starred` | boolean | no       | Whether the folder is starred. `"true"`/`"false"` accepted |

**Request**

```bash
curl -sS -X PATCH https://omnicloud.example.com/api/folders/tz4a98xxat96iws9zmbrgj3d \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "New name", "starred": true}'
```

**Response** `200` — the folder object.

**Errors**: `400 INVALID_REQUEST`, `404 FOLDER_NOT_FOUND`.

### `POST /api/folders/:id/move`

Moves a folder under a new parent, or to the root with `null`.

**Body**

| Field      | Type           | Required | Notes                    |
| ---------- | -------------- | -------- | ------------------------ |
| `parentId` | string \| null | yes      | The new parent folder id |

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/folders/tz4a98xxat96iws9zmbrgj3d/move \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"parentId": "tz4a98xxat96iws9zmbrgj40"}'
```

**Response** `200` — the folder object, with the new `parentId`.

**Errors**: `400 INVALID_REQUEST` (moving a folder into itself or into one of
its descendants), `404 FOLDER_NOT_FOUND`, `409 CONFLICT` (the target is in the
Trash).

### `POST /api/folders/:id/trash`

Moves the folder **and its entire subtree** (folders and files) to the Trash.
Nothing is deleted from the channel, so a restore is lossless. Everything moved
by this one operation is stamped with a shared trash batch id.

**Body** — none.

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/folders/tz4a98xxat96iws9zmbrgj3d/trash \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200`

```json
{ "affectedFolders": 3, "affectedFiles": 12 }
```

**Errors**: `404 FOLDER_NOT_FOUND`.

### `POST /api/folders/:id/restore`

Restores the folder subtree. Only nodes trashed **together with the folder**
(the same batch) are restored; anything the user trashed separately stays in
the Trash. If the parent chain is still trashed, the folder is restored to the
root.

**Body** — none.

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/folders/tz4a98xxat96iws9zmbrgj3d/restore \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200`

```json
{ "affectedFolders": 3, "affectedFiles": 12 }
```

**Errors**: `404 FOLDER_NOT_FOUND`.

### `DELETE /api/folders/:id`

**Permanently deletes** the folder subtree: the channel objects of its files
are removed first, then the file metadata, then the folder rows. Folders that
still contain a file whose remote delete failed are kept, so the operation can
be retried.

**Body** — none.

**Request**

```bash
curl -sS -X DELETE https://omnicloud.example.com/api/folders/tz4a98xxat96iws9zmbrgj3d \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200`

```json
{ "affectedFolders": 3, "affectedFiles": 12 }
```

**Errors**: `404 FOLDER_NOT_FOUND`, `502` (mapped provider error),
`401 TELEGRAM_AUTH_REQUIRED`.

---

## Trash

The Trash is a view over soft-deleted records. Nothing is removed from the
channel until the trash is emptied, purged or an item is deleted permanently.

| Endpoint                   | Method | Purpose                                      |
| -------------------------- | ------ | -------------------------------------------- |
| `GET /api/trash`           | GET    | List what is in the Trash                    |
| `POST /api/trash/empty`    | POST   | Delete everything in the Trash permanently   |
| `GET /api/trash/retention` | GET    | The retention period in days                 |
| `POST /api/trash/purge`    | POST   | Delete the items whose retention has expired |

### `GET /api/trash`

Lists everything currently in the Trash, across all folders. The `folderId`
scope is intentionally ignored, and `status` is forced to `trashed`. The name,
size and type filters still apply.

**Query parameters**

| Parameter                                              | Notes                                             |
| ------------------------------------------------------ | ------------------------------------------------- |
| `page`, `limit`                                        | Pagination. Default page 1, limit 50, maximum 200 |
| `q`, `type`, `ext`, `minSize`, `maxSize`, `from`, `to` | The shared filters                                |

**Request**

```bash
curl -sS "https://omnicloud.example.com/api/trash?limit=2" \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200`

```json
{
  "files": [],
  "folders": [],
  "pagination": { "page": 1, "limit": 2, "total": 14, "hasMore": true }
}
```

Files and folders are each paginated with the same `page` and `limit`; `total`
is the combined count.

### `POST /api/trash/empty`

Permanently removes everything in the Trash. Channel objects are deleted first;
files whose remote delete fails are **left in the Trash** and reported in
`failedFiles`, so the operation can be retried.

**Body** — none.

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/trash/empty \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200`

```json
{ "deletedFiles": 12, "deletedFolders": 5, "failedFiles": 1 }
```

**Errors**: `401 TELEGRAM_AUTH_REQUIRED`, `502` (mapped provider error).

### `GET /api/trash/retention`

How long trashed items are kept before they are removed for good. This is the
server's `TRASH_RETENTION_DAYS` setting, 30 days by default. `0` would mean the
trash is kept indefinitely.

**Query parameters** — none.

**Request**

```bash
curl -sS https://omnicloud.example.com/api/trash/retention \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200`

```json
{ "days": 30 }
```

### `POST /api/trash/purge`

Removes the caller's own expired trash now, without waiting for the scheduled
job. Items that are still within their retention period are left alone and
counted in `skippedFiles`.

**Body** — none.

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/trash/purge \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200`

```json
{ "deletedFiles": 3, "deletedFolders": 1, "failedFiles": 0, "skippedFiles": 5 }
```

The server also runs this on a schedule, every six hours, for every user, so
expired items disappear even if nobody calls this endpoint. Channel objects
are deleted before their records, as with `POST /api/trash/empty`.

**Errors**: `401 TELEGRAM_AUTH_REQUIRED`, `502` (mapped provider error).

---

## Collections

The read-only views the Drive UI is built from.

| Endpoint            | Method | Purpose                     |
| ------------------- | ------ | --------------------------- |
| `GET /api/starred`  | GET    | Starred files and folders   |
| `GET /api/recent`   | GET    | Recently touched files      |
| `GET /api/search`   | GET    | Full-text and filter search |
| `GET /api/activity` | GET    | Activity feed               |

### `GET /api/starred`

Lists starred files and folders, across all folders. The shared query set
applies; `starred` is forced to `true` and the folder scope is dropped. Only
**active** items are returned unless you pass `status=trashed` or `status=all`.

**Query parameters**: the shared [sorting and filtering](#sorting-and-filtering)
set, except `starred` and the folder scope, which the endpoint fixes.

**Request**

```bash
curl -sS https://omnicloud.example.com/api/starred \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200`

```json
{
  "files": [],
  "folders": [
    {
      "id": "tz4a98xxat96iws9zmbrgj3d",
      "name": "Documents",
      "parentId": null,
      "starred": true,
      "trashed": false,
      "deletedAt": null,
      "createdAt": "2026-08-01T10:00:00.000Z",
      "updatedAt": "2026-08-02T10:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 5, "hasMore": false }
}
```

### `GET /api/recent`

The most recently touched **active** files, newest activity first. Only these
actions count: `upload`, `download`, `open`, `rename`, `move`, `replace`.
Trashed and permanently deleted files are filtered out.

**Query parameters**

| Parameter | Notes                              |
| --------- | ---------------------------------- |
| `page`    | 1-based page number                |
| `limit`   | Page size, default 50, maximum 200 |

**Request**

```bash
curl -sS https://omnicloud.example.com/api/recent \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200`

```json
{
  "items": [
    {
      "file": {
        "id": "tz4a98xxat96iws9zmbrgj3a",
        "name": "report.pdf",
        "size": 1048576,
        "mimeType": "application/pdf",
        "sha256": "8e1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c",
        "folderId": null,
        "starred": false,
        "trashed": false,
        "deletedAt": null,
        "versionCount": 1,
        "currentVersionId": "tz4a98xxat96iws9zmbrgj3e",
        "createdAt": "2026-08-01T10:00:00.000Z",
        "updatedAt": "2026-08-01T10:00:00.000Z"
      },
      "lastAction": "download",
      "lastActionAt": "2026-08-01T11:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 1, "hasMore": false }
}
```

`lastAction` is one of the `ACTIVITY_ACTIONS` values. The file object in this
view does not carry the four encryption fields; use `GET /api/files/:id` for
those.

### `GET /api/search`

Searches files and folders. The full query language is documented in
[Search query language](#search-query-language).

**Query parameters**

| Parameter       | Notes                                                                |
| --------------- | -------------------------------------------------------------------- |
| `q` (required)  | The query string. At most 200 characters. An empty value is rejected |
| `page`, `limit` | Pagination. Default page 1, limit 50, maximum 200                    |

**Request**

```bash
curl -sS --get https://omnicloud.example.com/api/search \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "q=report type:pdf size:>1MB"
```

**Response** `200`

```json
{
  "files": [],
  "folders": [],
  "pagination": { "page": 1, "limit": 50, "total": 4, "hasMore": false }
}
```

By default search covers active **and** trashed items. Files and folders are
each paginated with the same `page` and `limit`; `total` is the combined count.

**Errors**: `400 INVALID_REQUEST` (empty or longer than 200 characters).

### `GET /api/activity`

The activity feed, newest first.

**Query parameters**

| Parameter | Notes                              |
| --------- | ---------------------------------- |
| `page`    | 1-based page number                |
| `limit`   | Page size, default 50, maximum 200 |

**Request**

```bash
curl -sS https://omnicloud.example.com/api/activity \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200`

```json
{
  "events": [
    {
      "id": "tz4a98xxat96iws9zmbrgj50",
      "action": "upload",
      "resourceType": "file",
      "resourceId": "tz4a98xxat96iws9zmbrgj3a",
      "resourceName": "report.pdf",
      "metadata": { "size": 1048576, "mimeType": "application/pdf" },
      "createdAt": "2026-08-01T10:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 1, "hasMore": false }
}
```

`action` is one of `upload`, `download`, `open`, `rename`, `move`, `star`,
`unstar`, `trash`, `restore`, `delete`, `create_folder`, `replace`,
`restore_version`, `delete_version`, or `other` for an action this version
does not recognise. `resourceType` is `file`, `folder` or `storage`.
`metadata` is sanitized: credential-shaped keys (matching `password`,
`secret`, `token`, `session`, `hash` or `credential`) are stripped before
storage.

### Search query language

`GET /api/search?q=…` takes a tokenized query. Tokens are separated by
whitespace. A token of the form `field:value` sets a filter; every other token
becomes free text.

| Token                            | Meaning                                                                                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `report`                         | Free text; case-insensitive name substring                                                                                                               |
| `name:report`, `filename:report` | Explicit name filter. The value becomes free text                                                                                                        |
| `type:pdf`                       | Coarse category: `image`, `video`, `audio`, `pdf`, `archive`, `document`, `text`                                                                         |
| `type:application/pdf`           | Exact MIME type                                                                                                                                          |
| `ext:zip`, `extension:zip`       | Filename extension, with or without a leading dot                                                                                                        |
| `size:>100MB`                    | Size comparison: `>`, `>=`, `<`, `<=`, `=`. Units `b`, `kb`, `mb`, `gb`, `tb` (1024-based; a bare number is bytes). A bare `size:5mb` means exactly 5 MB |
| `folder:Projects`                | Restricts to items whose own folder is one whose name contains `Projects`                                                                                |
| `starred:true`                   | Starred only. `true`, `1`, `yes`, `y`, `on` are true; `false`, `0`, `no`, `n`, `off` are false                                                           |
| `trashed:true`                   | Trashed only. `trashed:false` (alias `deleted:`) means active only                                                                                       |
| `after:2026-01-01`, `since:...`  | Inclusive lower bound on the creation date                                                                                                               |
| `before:2026-06-01`              | Inclusive upper bound on the creation date                                                                                                               |

Rules:

- The last occurrence of a field wins.
- An unknown field, an empty value (`report:`) or an unparseable value falls
  back to free text.
- A plain date means the start of that UTC day for `after:` and the end of
  that UTC day for `before:`. Any other date string is parsed as a date-time.
- `size:` with `>` means strictly larger, `<` strictly smaller, `>=` and `<=`
  inclusive, and `=` (the default) means exactly that size.
- `type:other` has no MIME matchers, so the filter is dropped, but folders are
  still excluded from the result because the filter is file-only.
- `type:`, `ext:` and `size:` filters only a file can satisfy, so folders are
  excluded from the result entirely when one of them is present.
- Search covers **both active and trashed** items unless `trashed:` narrows
  the scope.
- Files and folders are each paginated with the same `page` and `limit`; the
  envelope's `total` is the combined count.

Examples:

| Query                                | Returns                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `report`                             | Active and trashed items whose name contains "report"                    |
| `name:report type:pdf`               | Active and trashed PDFs whose name contains "report"                     |
| `ext:zip size:>100MB`                | ZIP files larger than 100 MB; no folders                                 |
| `folder:Projects starred:true`       | Starred items inside folders named like "Projects"                       |
| `after:2026-01-01 before:2026-06-01` | Items created from the start of 1 January 2026 to the end of 1 June 2026 |
| `trashed:true type:image`            | Trashed images                                                           |

> The same language is implemented in `packages/shared/src/query.ts`, and
> `packages/shared/src/search.ts` mirrors the server's filters, so a query
> answered from a client-side index returns the same things as one answered by
> the server.

---

## Tokens

Personal API tokens authenticate scripts, the CLI and other non-browser
clients. They are created and revoked explicitly, they never expire on their
own, and they are account-wide.

| Endpoint                 | Method | Purpose                   |
| ------------------------ | ------ | ------------------------- |
| `POST /api/tokens`       | POST   | Issue a token             |
| `GET /api/tokens`        | GET    | List the tokens' metadata |
| `DELETE /api/tokens/:id` | DELETE | Revoke a token            |

### `POST /api/tokens`

Issues a token. The secret is returned exactly once and is never stored or
logged; only its SHA-256 hash is kept.

**Body**

| Field  | Type   | Required | Notes                                                 |
| ------ | ------ | -------- | ----------------------------------------------------- |
| `name` | string | yes      | A label for the token. 1–80 characters after trimming |

**Request**

```bash
curl -sS -X POST https://omnicloud.example.com/api/tokens \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "CI runner"}'
```

**Response** `201`

```json
{
  "id": "tz4a98xxat96iws9zmbrgj60",
  "name": "CI runner",
  "createdAt": "2026-08-01T10:00:00.000Z",
  "token": "0kP3sZQvJ1r8Yx2N7mQaBd4EfGh6IjKlMnOpQrStUv"
}
```

Send the secret as `Authorization: Bearer <token>`.

**Errors**: `400 INVALID_REQUEST` (missing name, or a name outside 1–80
characters).

### `GET /api/tokens`

Lists the tokens of the signed-in user. It returns metadata only, never a
secret.

**Query parameters** — none.

**Request**

```bash
curl -sS https://omnicloud.example.com/api/tokens \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200`

```json
{
  "tokens": [
    {
      "id": "tz4a98xxat96iws9zmbrgj60",
      "name": "CI runner",
      "createdAt": "2026-08-01T10:00:00.000Z",
      "lastUsedAt": "2026-08-02T09:00:00.000Z",
      "revokedAt": null
    }
  ]
}
```

### `DELETE /api/tokens/:id`

Revokes a token. Revocation takes effect on the token's next use.

**Path parameters**

| Parameter | Type   | Required | Notes        |
| --------- | ------ | -------- | ------------ |
| `id`      | string | yes      | The token id |

**Request**

```bash
curl -sS -X DELETE https://omnicloud.example.com/api/tokens/tz4a98xxat96iws9zmbrgj60 \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `204`, no body.

**Errors**: `404 NOT_FOUND` (no such token for this user).

---

## Update

The update check tells the client whether a newer release of the npm package
exists. It is public, like the health probes: it exposes only the running
version and the newest published version of an open-source package, neither of
which is user data.

| Endpoint                | Method | Purpose                             |
| ----------------------- | ------ | ----------------------------------- |
| `GET /api/update/check` | GET    | The cached result of the last check |

### `GET /api/update/check`

The server checks the npm registry on a fixed interval (every hour) and caches
the result, so polling this endpoint never touches the registry.

**Query parameters** — none.

**Request**

```bash
curl -sS https://omnicloud.example.com/api/update/check
```

**Response** `200`

```json
{
  "status": "update_available",
  "currentVersion": "0.5.0",
  "latestVersion": "0.4.1",
  "packageName": "@hilbras/omnicloud",
  "checkedAt": "2026-08-01T09:00:00.000Z",
  "detail": null
}
```

| `status`           | Meaning                                                                    |
| ------------------ | -------------------------------------------------------------------------- |
| `update_available` | A newer version exists. This is the only state that should prompt the user |
| `up_to_date`       | The running version is the newest published version                        |
| `unknown`          | The check could not complete. `detail` says why                            |
| `not_published`    | The package is not on npm. `detail` says so                                |

When the first check has not completed yet, the endpoint answers `status:
"unknown"` with an empty `currentVersion` and `latestVersion: null`, rather
than reporting a false "up to date". The response always carries
`cache-control: no-store`.

The check can be disabled with `UPDATE_CHECK_ENABLED=false`, in which case the
endpoint keeps returning the "not completed yet" shape.

---

## Error codes

Every code below is a value of `ERROR_CODES` in
`packages/shared/src/index.ts`. The HTTP status comes from the matching error
class in `packages/core/src/errors.ts`.

| Code                         | HTTP | What it means                                                                                                                             |
| ---------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_REQUEST`            | 400  | The request body, field, enum or batch id list did not validate. Also used for a client cancellation (status 499)                         |
| `AUTH_REQUIRED`              | 401  | No session cookie and no valid bearer token on a protected route                                                                          |
| `AUTH_INVALID`               | 401  | The session token is no longer valid, or the account no longer exists                                                                     |
| `PERMISSION_DENIED`          | 403  | A cross-origin state-changing request was rejected, or Telegram refused the operation (banned number, no write access to the channel)     |
| `NOT_FOUND`                  | 404  | A generic missing resource, an unknown route, or no pending Telegram login                                                                |
| `FILE_NOT_FOUND`             | 404  | The file does not exist, is owned by another user, or its version does not belong to it                                                   |
| `FOLDER_NOT_FOUND`           | 404  | The folder does not exist or is owned by another user                                                                                     |
| `CONFLICT`                   | 409  | The operation conflicts with the current state: the target folder is in the Trash, an upload key was reused, a version is already current |
| `PAYLOAD_TOO_LARGE`          | 413  | The upload exceeds `MAX_UPLOAD_MB` or the multipart limit                                                                                 |
| `RATE_LIMITED`               | 429  | The auth rate limiter was hit, or Telegram returned a flood wait                                                                          |
| `STORAGE_NOT_INITIALIZED`    | 409  | The account has no storage channel, or the stored channel reference is stale                                                              |
| `STORAGE_UNAVAILABLE`        | 503  | The storage backend is reachable but failing                                                                                              |
| `TELEGRAM_AUTH_REQUIRED`     | 401  | The Telegram session was revoked or expired; the account must reconnect                                                                   |
| `TELEGRAM_CONNECTION_FAILED` | 502  | Telegram was unreachable, or an RPC or network failure occurred                                                                           |
| `TELEGRAM_FILE_NOT_FOUND`    | 404  | The stored message is gone from the channel, or its file reference expired                                                                |
| `UPLOAD_FAILED`              | 502  | The upload failed at the storage layer. Downloads report a storage-layer failure the same way                                             |
| `DOWNLOAD_FAILED`            | 502  | Defined in `packages/core/src/errors.ts` but never thrown and not exported                                                                |
| `INTEGRITY_CHECK_FAILED`     | 502  | The integrity verification of a streamed object failed                                                                                    |
| `INTERNAL_ERROR`             | 500  | An unhandled server error. The message is always the generic "Internal server error"                                                      |

Additional notes:

- A client cancellation surfaces as code `INVALID_REQUEST` with the
  non-standard status `499` (`OperationCancelledError`).
- `StorageProviderError` is deprecated and maps to
  `TELEGRAM_CONNECTION_FAILED` (502).
- Fastify's own body-too-large and file-too-large errors are normalized to
  `PAYLOAD_TOO_LARGE` (413).
- Any other Fastify error that carries a `statusCode` is returned with that
  status and the code `INVALID_REQUEST`.
- `details` is only added when the error carries one, for example the raw
  Telegram error code inside a `TELEGRAM_CONNECTION_FAILED`.
