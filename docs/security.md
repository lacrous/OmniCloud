# Security

OmniCloud v0.2 security posture, threat model and hardening notes.

## What is (and isn't) protected

| Aspect | v0.2 status |
| --- | --- |
| Telegram credentials / MTProto session | Stored server-side only (PostgreSQL); never logged, never exposed to the browser or API clients |
| Browser session | httpOnly, SameSite=Lax signed JWT cookie; 30-day expiry; `COOKIE_SECURE=true` required for HTTPS deployments |
| Authorization | Every operation verifies ownership server-side from the session; a client-supplied user id is never trusted |
| Input validation | All request bodies, params and query strings validated server-side; filenames sanitized (path components stripped, control/unsafe characters removed) |
| MIME types | Never trusted from the client — derived server-side from the filename extension |
| Auth endpoints | Rate limited (10/min per IP); Telegram 2FA fully supported |
| CSRF | Origin allowlist enforced on all state-changing requests, layered on SameSite=Lax cookies |
| Security headers | Applied to every response (list below) |
| Request tracing | Every request has a request id, echoed to the client and included in error bodies |
| Integrity | SHA-256 computed server-side on every upload; re-verified on download; periodic read-only drift checks |
| Activity metadata | Credential-shaped keys stripped before events are stored |
| Secrets in VCS | `.env` is gitignored; `.env.example` documents all variables |
| End-to-end encryption | **Not implemented** — Telegram can technically read channel content |

## Request ids and security headers

Every request is assigned a request id: the inbound `x-request-id` header is
honored when it is 1–128 characters, otherwise a UUID is generated. It is
echoed on the response and included in every structured error body, so an error
report can be correlated with the exact server log line without exposing
anything sensitive.

`SECURITY_HEADERS` (from `apps/api/src/http.ts`) is applied to every response:

| Header | Value | Purpose |
| --- | --- | --- |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing |
| `X-Frame-Options` | `DENY` | Block framing (clickjacking) |
| `Referrer-Policy` | `no-referrer` | Do not leak URLs to third parties |
| `Cross-Origin-Resource-Policy` | `same-origin` | Restrict cross-origin reads |
| `Cross-Origin-Opener-Policy` | `same-origin` | Isolate the browsing context |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=()` | Disable unneeded powerful features |
| `X-Permitted-Cross-Domain-Policies` | `none` | Block legacy Flash/PDF cross-domain policy files |

CSP is intentionally omitted here: the API serves JSON/binary data only, and
the SPA (served separately or via `WEB_DIST_DIR`) sets its own policy.

## CSRF and the origin allowlist

State-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) must pass an origin
check in `isAllowedOrigin`:

- If `ALLOWED_ORIGINS` is configured, the request's `Origin` must exactly match
  one of the listed origins.
- Otherwise, the origin's host must equal the request `Host` header
  (same-origin).
- Requests with **no** `Origin` header (curl, server-to-server SDK calls) are
  permitted; only browsers send `Origin`, so this does not weaken the browser
  threat model.
- A mismatch returns `403 PERMISSION_DENIED`.

This is defense-in-depth on top of `SameSite=Lax` cookies: even if a cookie
were sent cross-site, the origin check rejects the mutation.

## Authentication hardening

- **Rate limiter.** The three Telegram login endpoints
  (`/api/auth/telegram/start|verify|password`) are limited to 10 requests per
  minute per IP; exceeding it returns `429 RATE_LIMITED`. This slows code
  guessing and login-code spam.
- **Phone validation.** Phone numbers must match the international-format
  pattern before any Telegram call.
- **Pending-login isolation.** Login flows are in-memory, keyed by phone, and
  expire after 5 minutes; starting a new login cancels and disconnects the
  previous one.
- **2FA.** Two-factor accounts complete sign-in via GramJS `computeCheck` (SRP),
  so the password is never sent in the clear. `SESSION_PASSWORD_NEEDED` is
  handled explicitly; failure returns `PASSWORD_HASH_INVALID` as
  `400 INVALID_REQUEST`.
- **Session cookie.** Signed JWT, `httpOnly`, `SameSite=Lax`, `path=/`, 30-day
  `maxAge`, `secure` controlled by `COOKIE_SECURE`. The signing key is
  `SESSION_SECRET`; rotating it invalidates all existing sessions (by design).

## Telegram session protection

The MTProto session string is the most sensitive value in the system: it grants
full access to the user's Telegram account.

- It is stored only in `TelegramSession.stringSession` in PostgreSQL and handed
  only to `TelegramClientManager`.
- It is **never logged**, never included in an API response or DTO, and never
  written into activity metadata.
- The connection manager keeps an explicit lifecycle state per user; failures
  are mapped to structured errors whose messages contain no session material.
- `mapTelegramError` sanitizes all Telegram failures, and the API error handler
  only ever serializes the domain error's `message`/`code`/`details` — none of
  which are credential material.
- Logout drops the in-memory connection but does not revoke the session on
  Telegram's side; revocation must be done in Telegram Settings → Devices. If
  the server is compromised, revoke the device there and rotate
  `SESSION_SECRET`.

## Ownership and data isolation

- Every service method receives the **server-derived** user id from the session
  (never from the request body or params) and re-checks `record.userId` before
  acting.
- Records owned by another user answer as `404` (`FILE_NOT_FOUND` /
  `FOLDER_NOT_FOUND` / `NOT_FOUND`), not `403`, so their existence is not
  leaked. `403` is reserved for genuine permission denials such as a rejected
  cross-origin request.
- Folder operations validate the target parent's ownership and reject cycles
  (a folder cannot be moved into itself or a descendant).

## Input handling

- **Path-traversal-safe filenames.** `sanitizeFileName` takes only the last path
  component (splitting on `/` and `\`), strips control characters
  (`U+0000`–`U+001F`, `U+007F`), replaces `< > : " | ? *` with `_`, trims, and
  rejects empty/`.`/`..`. The result is capped at 255 characters. An empty result
  is a `400 INVALID_REQUEST`.
- **Server-derived MIME types.** `mimeFromFilename` maps the extension to a MIME
  type; anything unknown becomes `application/octet-stream`. Client-supplied MIME
  types are ignored, so they cannot influence stored metadata or the
  `Content-Type` served on download.
- **Download disposition.** `Content-Disposition` is built with both an ASCII
  sanitized filename and an RFC 5987 `filename*=UTF-8''...` form, so header
  injection via filenames is not possible.
- **Bounded inputs.** JSON body limit is 2 MB; multipart is capped at one file,
  10 parts and `MAX_UPLOAD_MB`; batch ids are limited to 500; search queries to
  200 characters.

## Integrity and reliability as security properties

- **SHA-256 is computed server-side** on every upload (client hashes are never
  trusted), stored on the `File`/`FileVersion`, and re-verified on download. The
  result is exposed via `X-Integrity-Verified`; a mismatch is also logged.
- **Read-only integrity checks.** `POST /api/storage/integrity/check` only
  reports drift (`missing`, `size_mismatch`, `hash_mismatch`, `unreadable`). It
  never deletes, rewrites or re-uploads. Repairs are a separate, explicit step,
  so a scan cannot silently destroy data.
- **Remote-object-first permanent deletes.** Permanent deletion removes the
  Telegram object before the metadata. If the remote delete fails, metadata is
  kept (and reported) instead of orphaning a storage object.
- **Metadata only after storage success.** The database never advertises a file
  whose bytes were not stored.
- **Failure reporting over silent repair.** Batch operations and empty-trash
  report per-item failures rather than pretending success.

## Design decisions

**404 instead of 403 for foreign resources.** Files and folders owned by another
user return `404` so their existence is not leaked. This is the same choice that
drives returning `404` for missing resources.

**Session scope.** The Telegram MTProto session is used only by the server. The
web app and SDK authenticate against OmniCloud's own session system, so revoking
a browser session never touches the Telegram account, and Telegram credentials
never transit the frontend.

**Activity metadata sanitization.** `ActivityService.sanitizeMetadata` drops any
key matching `password`, `secret`, `token`, `session`, `hash` or `credential`, so
the audit log cannot become a place where secrets leak. Activity recording is
best-effort: a logging failure never fails the user-facing operation.

## Recommendations for operators

1. **Set `SESSION_SECRET`** to a long random value (`openssl rand -hex 32`) in
   production; keep it stable and identical across processes.
2. **Serve over HTTPS** (reverse proxy) and set `COOKIE_SECURE=true`.
3. **Set `TRUST_PROXY=true`** behind a proxy so client IPs (and therefore the
   auth rate limiter) are correct.
4. **Configure `ALLOWED_ORIGINS`** if the UI is served from a different origin.
5. **Bind the API to localhost or a private network** if it should not be
   publicly reachable.
6. **Back up PostgreSQL** — it holds the only mapping between the drive
   structure and Telegram messages, and the storage channel id/access hash.
   Protect those backups as you would the session itself.
7. **Do not reuse** the Telegram api_id/api_hash across many automated
   deployments; Telegram enforces account-level limits.
8. **Revoke the Telegram session** in Telegram Settings → Devices if the server
   is compromised.

## Known v0.2 gaps (accepted)

- **No end-to-end encryption.** Telegram can technically read channel content.
  E2E would require client-side key management that a plain web app cannot fully
  guarantee; it is not implemented and not planned for the near term.
- **The rate limiter is single-process and in-memory.** It is not shared across
  replicas and resets on restart; it protects the auth endpoints only. This
  matches the single-process deployment model.
- **No CSP on API responses.** The API serves JSON/binary only; the SPA sets its
  own CSP.
- **Uploads/downloads are buffered in memory** (bounded by `MAX_UPLOAD_MB`),
  which is a resource-exhaustion consideration for untrusted or
  multi-tenant deployments.
- **One MTProto connection per user per process.** Running multiple API
  replicas against the same account can trigger Telegram session duplication;
  horizontal scaling is out of scope.
- **Telegram-side access is outside OmniCloud's control.** A user who deletes
  the storage channel or removes the device can invalidate stored objects; this
  surfaces as `missing` integrity issues, not as a security breach.

## Reporting

Please report security issues privately to the maintainers (see the GitHub
repository's security policy) rather than opening a public issue.