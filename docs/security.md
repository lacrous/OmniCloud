# Security

OmniCloud stores the file bytes in a private Telegram channel inside your own
Telegram account, and keeps the drive's logical structure in PostgreSQL. That
arrangement decides what a compromised server can reach, so this document
describes the trust model first and the controls second.

Read these two documents next to this one:

- [`limitations.md`](limitations.md) lists what this release does **not**
  guarantee. Check it before you rely on any property here.
- [`../SECURITY.md`](../SECURITY.md) is the responsible-disclosure policy and
  the reporting channel.

> **Note:** No independent security or cryptographic review of this project has
> taken place. The encryption protocol is described as experimental because it
> has not been reviewed. See
> [End-to-end encryption status](#end-to-end-encryption-status). The only
> review recorded in this project is an internal self-review of the v0.2.x
> line: [Findings from the internal v0.2.x self-review](#findings-from-the-internal-v02x-self-review).

## Contents

- [Trust model](#trust-model)
- [What the server and Telegram can see](#what-the-server-and-telegram-can-see)
- [Sessions and tokens](#sessions-and-tokens)
- [Telegram sessions at rest](#telegram-sessions-at-rest)
- [Authorization and ownership](#authorization-and-ownership)
- [Input handling](#input-handling)
- [Rate limiting and the origin allow-list](#rate-limiting-and-the-origin-allow-list)
- [Security headers and content security policy](#security-headers-and-content-security-policy)
- [Logging and redaction](#logging-and-redaction)
- [Integrity as a security property](#integrity-as-a-security-property)
- [Findings from the internal v0.2.x self-review](#findings-from-the-internal-v02x-self-review)
- [End-to-end encryption status](#end-to-end-encryption-status)
- [Operator checklist](#operator-checklist)
- [Open advisory: deepmerge-ts via Prisma (operator action)](#open-advisory-deepmerge-ts-via-prisma-operator-action)
- [Reporting](#reporting)

## Trust model

Four parties hold something you care about. Each one is trusted for something
different, and each one is outside the trust boundary for something else.

| Party                                 | Trusted for                                                      | Not trusted for                                                                     |
| ------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Client** (browser, SDK, CLI)        | Your files, your keys, and what it sends                         | The server's own integrity — it is trusted with your key and your plaintext         |
| **OmniCloud server** (API + database) | Metadata, account state, and the Telegram session                | File contents, once client-side encryption is on                                    |
| **PostgreSQL**                        | The drive's structure: folders, versions, trash, stars, activity | File bytes — it never holds them                                                    |
| **Telegram**                          | Holding and returning the objects                                | Anything at all: Telegram reads the channel, and so can anyone who uses the account |

The consequences, stated plainly:

- **The server operator can read your metadata.** Folder names, file names
  (unless you use the OCE2 format), sizes, MIME types, timestamps and hashes
  are stored in a database the operator can read and back up.
- **Telegram can read your file contents.** OmniCloud runs as _your_ Telegram
  account, so the channel is not blind to the content.
- **The client holds the keys.** With client-side encryption on, the root key
  never leaves the device that generated it. A server compromise therefore does
  not hand over file contents — only metadata, and only for files you have not
  yet encrypted.

The adversary this design is built against is a **curious or compromised
operator** and **a storage provider that reads what it stores**. It is not built
to protect you from an attacker who already controls your device, your Telegram
account, or the delivery of the client code.

## What the server and Telegram can see

| Data                                   | Default (no encryption)                   | OCE1 encryption (opt-in) | OCE2 (not enabled by default) |
| -------------------------------------- | ----------------------------------------- | ------------------------ | ----------------------------- |
| File contents                          | visible to server + Telegram              | ciphertext for both      | ciphertext for both           |
| File name (`File.name`)                | visible to server + Telegram              | visible to the server    | opaque placeholder            |
| Telegram document's filename attribute | the real name                             | the real name            | opaque placeholder            |
| Folder names                           | visible to the server                     | visible to the server    | visible to the server         |
| Size, MIME type, timestamps, SHA-256   | visible to the server                     | visible to the server    | visible to the server         |
| Your Telegram session string           | sealed at rest, never sent to the browser | the same                 | the same                      |

Two consequences follow, and they are the ones that matter most in practice:

1. **File names are visible by default.** Turning encryption on protects the
   content, not the name. The name stays in `File.name` in PostgreSQL and in the
   filename attribute of the Telegram document. Only the experimental OCE2 format
   replaces it with a random placeholder, and that format is not enabled by
   default.
2. **Content is protected only after encryption is enabled, per file.** A file
   uploaded before you turn encryption on stays plaintext until you migrate it.
   There is no silent fallback: an encrypted upload is stored as ciphertext or
   the upload fails.

Search matches metadata only. The server cannot search inside file contents.

## Sessions and tokens

OmniCloud uses server-side sessions. There is no signed token and no JWT.

**Browser session.** Signing in issues a 32-byte random token, base64url-encoded,
and sets it as the `omnicloud_session` cookie:

| Property              | Value                                                               |
| --------------------- | ------------------------------------------------------------------- |
| Token                 | 32 random bytes, base64url                                          |
| Stored server-side as | only the SHA-256 hash (`BrowserSession.tokenHash`)                  |
| Cookie flags          | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` from `COOKIE_SECURE` |
| Lifetime              | 30 days (`DEFAULT_SESSION_TTL_DAYS`)                                |
| Carries data          | nothing — it is an opaque handle                                    |

Every request resolves the cookie against the stored row: the token is hashed,
looked up, then checked for revocation and expiry. Three consequences:

- **A database read does not yield usable cookies.** Only the hash is stored.
- **Revocation is immediate.** `POST /api/auth/logout` revokes the current
  session; `POST /api/auth/logout-all` revokes every session for the account.
  Both take effect on the next request, not at token expiry.
- **Expiry is enforced server-side**, so a stolen cookie stops working on its
  own after 30 days. Expired rows are pruned hourly, seven days after they
  lapse.

`SESSION_SECRET` is reserved. It does not sign browser sessions and changing it
does not invalidate them.

**API token.** Personal access tokens for scripts and the SDK are sent as
`Authorization: Bearer <token>`. They are 32 random bytes, the server stores
only their SHA-256 hash (`ApiToken.tokenHash`), and the raw value is shown once
when the token is created. A revoked token stops working on its next use. Create
and revoke them from the web app, the SDK, or `POST /api/tokens` and
`DELETE /api/tokens/:id`.

**Scope.** The Telegram MTProto session is used only by the server. The web app
and the SDK authenticate against OmniCloud's own session system, so revoking a
browser session never touches the Telegram account and Telegram credentials
never transit the frontend.

**Public routes.** `/api/auth/*`, `/api/health*` and `/api/update/*` are
reachable without a session. Everything else under `/api/` requires a live
browser session or a valid bearer token. The update check exposes only the
running version and the newest published version of an open-source package.

## Telegram sessions at rest

The MTProto session string is the most sensitive value in the system: it grants
full access to your Telegram account.

**It is sealed before it reaches the database.** `TelegramSession.stringSession`
holds an AES-256-GCM envelope, not the session:

| Property  | Value                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| Algorithm | AES-256-GCM (`aes-256-gcm`)                                                                                 |
| IV        | 12 fresh random bytes per seal                                                                              |
| Envelope  | `v<keyVersion>:<iv>:<tag>:<ciphertext>`, base64url                                                          |
| Key       | `OMNICLOUD_ENCRYPTION_KEY`, derived with scrypt when it is a passphrase                                     |
| Key sizes | 64 hex characters used as the key directly, or a passphrase of at least 32 characters stretched with scrypt |

The envelope carries a key version, so a key can be rotated later while old
versions stay available for decryption.

**When the key is required.** `NODE_ENV=production` refuses to start without
`OMNICLOUD_ENCRYPTION_KEY`. Without a key — development only — the session is
stored unsealed, and a legacy plaintext session is re-sealed in place on its
next read, so upgrading leaves no plaintext behind.

**What the session never does:**

- It is never logged.
- It is never included in an API response or a DTO.
- It is never written into activity metadata.
- It is never sent to the browser.

The connection manager keeps an explicit lifecycle state per user, and
`mapTelegramError` converts every Telegram failure into a structured domain
error whose message carries no session material. The API error handler
serialises only the domain error's `code`, `message` and `details`.

> **Warning:** Logging out of OmniCloud does not revoke the session on
> Telegram's side. If the server is compromised, revoke the device in Telegram
> Settings → Devices; the stored session string becomes useless immediately.

## Authorization and ownership

**Every operation is authorized server-side, from the session.**

- The API's authentication hook puts the user id on the request. It comes from
  the session row or the bearer token's owner, never from a request body, a
  query parameter or a path segment.
- Every service method takes that user id as its first argument and re-checks
  the record's owner before acting. A file, folder or version belonging to
  another user is not found, not forbidden.
- Folder operations validate the target parent's ownership and reject cycles —
  a folder cannot be moved into itself or into one of its own descendants. The
  repository re-checks the ancestor chain and writes atomically, so a
  concurrent move cannot slip a cycle in between the check and the write.

**Foreign resources answer `404`, not `403`.** A file or folder owned by
another user returns `404` (`FILE_NOT_FOUND`, `FOLDER_NOT_FOUND`, `NOT_FOUND`),
so its existence is not disclosed. `403` is reserved for genuine permission
denials, such as a rejected cross-origin request.

The same applies to versions: a version id that belongs to another file, or to
another user, is a `404`. The current version cannot be deleted — the file
would have nothing to point at — and the error says so.

## Input handling

**Filenames are sanitised into a single safe path component.**
`sanitizeFileName` takes only the last path component (splitting on `/` and
`\`), strips control characters (`U+0000`–`U+001F`, `U+007F`–`U+009F`), strips
bidirectional overrides, isolates and zero-width characters, replaces
`< > : " | ? *` with `_`, trims the result, rejects an empty name, `.` and
`..`, and caps the result at 255 characters. An empty result is a
`400 INVALID_REQUEST`. Path traversal is therefore not expressible in a stored
name.

**Client-declared MIME types are never trusted.** `mimeFromFilename` maps the
filename extension to a MIME type; anything unknown becomes
`application/octet-stream`. The stored MIME type and the `Content-Type` served
on download both come from this function, so a client cannot influence either
by declaring a different type.

**Download headers are built, not echoed.** `Content-Disposition` carries both
an ASCII-sanitised filename and an RFC 5987 `filename*=UTF-8''...` form, so a
filename cannot inject a header.

**Inputs are bounded.**

| Input                    | Bound                                                |
| ------------------------ | ---------------------------------------------------- |
| JSON request body        | 2 MB                                                 |
| Multipart upload         | one file, 10 parts, `MAX_UPLOAD_MB` (default 256 MB) |
| Batch id arrays          | 500 ids                                              |
| Reconciliation approvals | 200 ids per request                                  |
| Page size                | 200 items                                            |

## Rate limiting and the origin allow-list

**Rate limiting.** A fixed-window, in-memory limiter guards the authentication
endpoints, keyed by client IP:

| Endpoint group                                                                       | Limit          |
| ------------------------------------------------------------------------------------ | -------------- |
| `POST /api/auth/telegram/start`, `/verify`, `/password`, `/qr/start`, `/qr/password` | 10 per minute  |
| `GET /api/auth/telegram/qr/status`                                                   | 120 per minute |
| `PUT`/`DELETE /api/auth/recovery`                                                    | 20 per minute  |

Exceeding a limit returns `429 RATE_LIMITED`. Phone numbers are validated
against an international-format pattern before any Telegram call, and pending
logins are held in memory per phone number and expire after 5 minutes.

> **Note:** The limiter is per process and in memory. It resets on restart and
> is not shared between replicas. Behind a reverse proxy it is only correct if
> `TRUST_PROXY` is set so the client IP is read from `X-Forwarded-For`. See
> [`deployment.md`](deployment.md).

**Origin allow-list.** Every state-changing request (`POST`, `PUT`, `PATCH`,
`DELETE`) must pass an origin check:

- If `ALLOWED_ORIGINS` is configured, the request's `Origin` must exactly
  match one of the listed origins.
- Otherwise the origin's host must equal the request's `Host` header.
- A request with **no** `Origin` header is permitted. Browsers send `Origin`,
  so this admits non-browser clients such as curl and the SDK and does not
  weaken the browser threat model.
- A mismatch returns `403 PERMISSION_DENIED`.

This is defence in depth on top of `SameSite=Lax`: even if a cookie were sent
cross-site, the origin check rejects the mutation. The QR sign-in status route
applies the same check, because it can issue a session cookie.

## Security headers and content security policy

**Baseline headers.** These are applied to every response, from
`apps/api/src/http.ts`:

| Header                              | Value                                      | Purpose                                          |
| ----------------------------------- | ------------------------------------------ | ------------------------------------------------ |
| `X-Content-Type-Options`            | `nosniff`                                  | Prevent MIME sniffing                            |
| `X-Frame-Options`                   | `DENY`                                     | Block framing (clickjacking)                     |
| `Referrer-Policy`                   | `no-referrer`                              | Do not leak URLs to third parties                |
| `Cross-Origin-Resource-Policy`      | `same-origin`                              | Restrict cross-origin reads                      |
| `Cross-Origin-Opener-Policy`        | `same-origin`                              | Isolate the browsing context                     |
| `Permissions-Policy`                | `geolocation=(), microphone=(), camera=()` | Disable unneeded powerful features               |
| `X-Permitted-Cross-Domain-Policies` | `none`                                     | Block legacy Flash/PDF cross-domain policy files |

**Content-Security-Policy.** The API serves JSON and binary data and carries
no policy. The web app, when it is served from the same port (`WEB_DIST_DIR`),
is sent one on every non-API page:

| Directive         | Value                                                |
| ----------------- | ---------------------------------------------------- |
| `default-src`     | `'self'`                                             |
| `script-src`      | `'self'` plus the SHA-256 hash of each inline script |
| `style-src`       | `'self'` plus the SHA-256 hash of each inline style  |
| `img-src`         | `'self' data: blob:`                                 |
| `font-src`        | `'self' data:`                                       |
| `connect-src`     | `'self'`                                             |
| `object-src`      | `'none'`                                             |
| `base-uri`        | `'self'`                                             |
| `form-action`     | `'self'`                                             |
| `frame-ancestors` | `'none'`                                             |

Inline scripts and styles are allowed **by hash only** — there is no
`unsafe-inline` and no `unsafe-eval`. The hashes are computed from the exact
bytes of the served `index.html` at startup, so an injected inline script (for
example one rendered from a malicious file name) does not match and is
blocked. If the page cannot be read, startup fails rather than serving it
without a policy.

**Request ids.** Every request gets an id: the inbound `x-request-id` header is
honoured when it is 1–128 characters long, otherwise a UUID is generated. It is
echoed on the response and included in every structured error body, so an error
report can be correlated with the exact server log line without exposing
anything sensitive.

## Logging and redaction

**The logger redacts secret-shaped fields.** Pino replaces the following paths
with `[Redacted]` before anything is written, both at the top level of a log
object and one level down:

`stringSession`, `session`, `cookie`, `password`, `code`, `token`,
`tokenHash`, `encryptionKey`, `sessionSecret`, `OMNICLOUD_ENCRYPTION_KEY`,
`SESSION_SECRET`, `TELEGRAM_API_HASH`, plus `req.headers.cookie`,
`req.headers.authorization` and `res.headers['set-cookie']`.

This is a backstop. Code still must not log those values in the first place.

**Activity metadata is filtered before it is stored.** Any key matching
`password`, `secret`, `token`, `session`, `hash` or `credential` is dropped
from the event's metadata, so the audit trail cannot become a place where
secrets leak. Activity recording is best-effort: a logging failure never fails
the user-facing operation.

**What a log record contains.** Uploads, permanent deletes and streamed
downloads each write one structured record with the operation, the user id, the
resource id, the size, the duration, the status and an error code. Records
never contain file contents.

## Integrity as a security property

- **SHA-256 is computed server-side** on every upload — a client-supplied hash
  is never trusted — stored on the file and its versions, and re-verified on
  download. The final bytes are withheld until the hash matches, so a corrupt
  object ends the response with a broken connection instead of completing with
  bad data. The download response carries the stored hash in `X-Content-SHA256`.
- **There is no `X-Integrity-Verified` header.** It was removed in 0.2.2
  because it cannot be known before the body has been sent.
- **Integrity checks are read-only.** `POST /api/storage/integrity/check` only
  reports drift (`missing`, `size_mismatch`, `hash_mismatch`, `unreadable`). It
  never deletes, rewrites or re-uploads. Repair is a separate, explicit step,
  so a scan cannot silently destroy data.
- **Permanent deletes are ordered safely.** The Telegram object is removed
  before the metadata. If the remote delete fails, the metadata is kept and the
  failure is reported, so nothing is silently orphaned.
- **Metadata never runs ahead of storage.** A file row is written only after
  the upload to Telegram succeeded, so the database never advertises bytes that
  are not stored.
- **Failures are reported, not repaired silently.** Batch operations and
  empty-trash return per-item failures instead of pretending to succeed.

## Findings from the internal v0.2.x self-review

This is **not** an independent review. It is a self-review pass the maintainer
made over the v0.2.x line, recorded here because the individual findings are
still worth knowing. No external party has reviewed this project, and no
finding below is a claim of assurance about the code as a whole.

| Area          | Finding                                                                                       | Status recorded at the time                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Authorization | Restore could attach a folder under another user's folder when a foreign parent id was given. | Fixed: the parent must belong to the same user. Covered by `packages/core/test/authorization.test.ts`.       |
| Authorization | Every id-taking route goes through an owner check.                                            | Covered by test: another user cannot read, rename, trash, download, move into, or restore a record.          |
| Web content   | The served page had no Content-Security-Policy, although a comment claimed one.               | Fixed: CSP on served pages, with scripts and styles allowed by hash only.                                    |
| Sessions      | No response may carry Telegram session material.                                              | Covered by test across sign-in, identity, storage and file responses (`apps/api/test/session-leak.test.ts`). |
| Filenames     | Path traversal, null bytes and length.                                                        | Covered by test: only the final path component is kept; control characters removed.                          |
| Rate limiting | Login limits are keyed by client IP, so behind a proxy they depend on `TRUST_PROXY`.          | Not changed. Operators must set `TRUST_PROXY` correctly.                                                     |
| Injection     | No raw SQL and no unsafe query builders in application code.                                  | Verified by search.                                                                                          |

The ownership checks, the cycle rejection, the served-page CSP and the
absence of raw SQL are all still present in the current code. The two items
marked "not changed" are still open, and the first is also listed in
[`limitations.md`](limitations.md).

## End-to-end encryption status

Client-side end-to-end encryption is implemented in the web app, the SDK and
the CLI. Its status is what matters, so state it plainly:

- **It is opt-in.** Encryption is off until you turn it on and generate a key.
  Files uploaded before that stay plaintext. The CLI migrates them with
  `omnicloud migrate <fileId|all>`; the web app migrates per file.
- **It is experimental.** The protocol is specified in
  [`security/encryption-protocol-v1.md`](security/encryption-protocol-v1.md) and
  implemented in `packages/crypto`. It is labelled experimental in the UI
  because the implementation may still change.
- **It has not been independently reviewed.** No external cryptographic review
  has taken place. The review package is assembled and tracked in
  [`audits/encryption-review.md`](audits/encryption-review.md); the review
  itself has not happened. Nothing in this project may describe the protocol as
  audited or production-ready.
- **The OCE2 format is not enabled by default.** It stores a file under a
  random placeholder so the server stops seeing its name. It is implemented
  behind a "Hide the name" action, it is unreviewed, and new uploads stay in
  OCE1 until the review covers the new format.
- **Trusted-device enrollment is designed but not implemented.** The design is
  in
  [`security/architecture-decisions/0003-trusted-device-enrollment.md`](security/architecture-decisions/0003-trusted-device-enrollment.md);
  there is no code for it.
- **Recovery depends on the recovery code.** A 256-bit recovery code derives a
  key that wraps your root key into an opaque blob. The server stores the blob
  and cannot open it. Lose the code and the files cannot be decrypted by
  anyone, including you. A password reset restores account access only — it
  cannot decrypt files.

**What the scheme does.** Each version gets its own data-encryption key. That
key is wrapped under a key derived from your root key with HKDF-SHA256, and
the content is sealed with XChaCha20-Poly1305 in 4 MiB chunks, with the file
id, version id, key epoch and chunk index bound into the additional
authenticated data. The manifest that closes the envelope is authenticated too,
so truncation, reordering and substitution fail closed. The server stores the
ciphertext, the wrapped key and an encrypted metadata blob, and never the
plaintext.

**What the scheme does not do.** It does not hide metadata: names, sizes, types
and timestamps stay visible to the server unless you also migrate the file to
OCE2. It does not protect a compromised client: the artifact delivered to your
browser is trusted with your key. It does not protect against a party who
controls both the client and the account.

## Operator checklist

1. **Set `OMNICLOUD_ENCRYPTION_KEY`** to a random value (`openssl rand -hex
32`) in production. It seals Telegram sessions at rest; keep it stable, back
   it up apart from the database, and never commit it. Losing it makes stored
   Telegram sessions unreadable.
2. **Serve over HTTPS** (reverse proxy) and set `COOKIE_SECURE=true`.
3. **Set `TRUST_PROXY=true`** behind a proxy so client IPs — and therefore the
   authentication rate limiter — are correct.
4. **Configure `ALLOWED_ORIGINS`** if the UI is served from a different origin.
5. **Bind the API to localhost or a private network** if it should not be
   publicly reachable.
6. **Back up PostgreSQL.** It holds the only mapping between the drive
   structure and the Telegram messages, and the storage channel id and access
   hash. Protect those backups as you would the session itself.
7. **Do not reuse** the Telegram `api_id`/`api_hash` across many automated
   deployments. Telegram enforces account-level limits.
8. **Revoke the Telegram device** in Telegram Settings → Devices if the server
   is compromised, and rotate `OMNICLOUD_ENCRYPTION_KEY` afterwards.
9. **Tell users to turn on client-side encryption** if a file's contents must
   survive the storage provider or a database compromise.

The remaining gaps are listed in [`limitations.md`](limitations.md).

## Open advisory: deepmerge-ts via Prisma (operator action)

`npm audit` reports three high-severity findings for `prisma`,
`@prisma/config` and `deepmerge-ts` (advisory GHSA-ggr8-5vv4-36mx: stack
exhaustion when merging recursive object graphs). Prisma 6.19.x pins
`deepmerge-ts` 7.x. npm ignores the `overrides` field of a published package,
so OmniCloud cannot fix this for you in its own dependency tree.

The exposure is in Prisma's configuration loader, which merges the configuration
file, not in request handling. To clear the warning in your installation, add an
override to the `package.json` of the project that runs OmniCloud, then
reinstall:

```json
{
  "overrides": {
    "deepmerge-ts": "^8.0.2"
  }
}
```

```bash
npm install
npx omnicloud migrate   # confirm Prisma still loads with the new version
npm audit               # the three findings should be gone
```

Re-run `npm audit` after each OmniCloud upgrade. Remove the override once a
Prisma release pins a patched `deepmerge-ts` by itself.

## Reporting

Report security issues privately, following the process in
[`../SECURITY.md`](../SECURITY.md). Do not open a public issue for a
vulnerability.
