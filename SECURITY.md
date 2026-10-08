# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

Use GitHub's [private vulnerability reporting](https://github.com/Lacrous/OmniCloud/security/advisories/new)
for the repository. Include a description, reproduction steps, the affected
version, and any proof-of-concept you have. We will acknowledge the report,
investigate, and coordinate a fix and disclosure with you.

## Supported versions

| Version | Supported                                                                   |
| ------- | --------------------------------------------------------------------------- |
| 0.2.x   | ✅                                                                          |
| 0.1.x   | ❌ (please upgrade — v0.2 adds trash safety, request tracing and hardening) |

## What OmniCloud protects

- **Telegram credentials and the MTProto session never leave the server.** The
  session string lives in PostgreSQL and is never returned by the API, never put
  in a response, and never logged. Only OmniCloud's own signed session cookie
  reaches the browser.
- **Every operation verifies ownership server-side.** The authenticated identity
  determines what you can touch; records belonging to another user are reported
  as `404`, so their existence is not leaked.
- **Metadata is never ahead of storage.** A file row exists only after the
  upload to Telegram succeeded, so the database never advertises bytes that are
  not stored.
- **Permanent deletion is ordered safely.** The remote object is removed first;
  if that fails the metadata is retained so nothing is silently orphaned or lost.
- **Inputs are validated and filenames are sanitized.** Path components are
  stripped (no traversal), control and unsafe characters are removed, and MIME
  types are derived server-side from the filename extension — the client's
  `Content-Type` is never trusted.
- **Baseline transport hardening.** `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `Cross-Origin-Resource-Policy: same-origin`, `Cross-Origin-Opener-Policy:
same-origin`, a restrictive `Permissions-Policy`, and `X-Permitted-Cross-Domain-Policies: none`.
- **State-changing requests are origin-checked.** `POST`/`PATCH`/`DELETE`
  require an allowed `Origin` (same-origin by default, or an explicit
  `ALLOWED_ORIGINS` list), on top of `SameSite=Lax` cookies.
- **Auth endpoints are rate limited**, every request carries a correlation id,
  and errors are returned in a structured, non-leaking envelope.

## What OmniCloud does **not** protect (v0.2)

- **End-to-end encryption is not implemented.** Files are stored as documents in
  your Telegram channel, so **Telegram can technically read their content**.
  OmniCloud is not a zero-knowledge vault — do not store material whose
  confidentiality must survive the storage provider.
- **No file sharing or public links**, so there is no sharing-specific access
  model to reason about yet.
- **Rate limiting is in-memory and single-process**, and only applied to the
  authentication endpoints.
- **Upload/download buffer in memory** (bounded by `MAX_UPLOAD_MB`), so a very
  large file can consume significant process memory.

## Operator guidance

- Set a long random `SESSION_SECRET` (`openssl rand -hex 32`) and keep it secret;
  rotating it signs everyone out.
- Serve over HTTPS and set `COOKIE_SECURE=true`; behind a proxy also set
  `TRUST_PROXY=true` so client IPs are read correctly.
- Set `ALLOWED_ORIGINS` if the web app is served from a different origin than
  the API.
- Back up PostgreSQL — it holds the only mapping between your drive and the
  Telegram messages.
- If you believe the server is compromised, revoke the session in Telegram
  (Settings → Devices); the stored string session becomes useless immediately.

## Handling of secrets in this repository

No credentials are committed. `.env` is gitignored, `.env.example` documents
every variable with placeholder values, and CI/release workflows read the npm
token from GitHub secrets rather than the repository.
