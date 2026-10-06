# Security

OmniCloud v0.1 security posture, threat model and hardening notes.

## What is (and isn't) protected

| Aspect                                 | v0.1 status                                                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Telegram credentials / MTProto session | Stored server-side only (PostgreSQL), never exposed to the browser or API clients                                                  |
| Browser session                        | httpOnly, SameSite=Lax signed JWT cookie; `COOKIE_SECURE=true` for HTTPS deployments                                               |
| Authorization                          | Every operation verifies ownership server-side; a client-supplied user id is never trusted                                         |
| Input validation                       | All request bodies/params validated server-side; filenames sanitized (path components stripped, control/unsafe characters removed) |
| MIME types                             | Never trusted from the client — derived server-side from the filename extension                                                    |
| Auth endpoints                         | Rate limited (10/min per IP); Telegram 2FA fully supported                                                                         |
| Secrets in VCS                         | `.env` is gitignored; `.env.example` documents all variables; the release workflow reads `NPM_TOKEN` from GitHub secrets           |
| End-to-end encryption                  | **Not implemented** — Telegram can technically read channel content                                                                |

## Design decisions

**404 instead of 403 for foreign resources.** Files/folders owned by another
user return `404 NOT_FOUND` so their existence is not leaked.

**Metadata ordering.** File metadata is persisted only after the storage
upload succeeded, so the database never advertises a file whose bytes were
not stored.

**Integrity.** Every upload's SHA-256 is computed server-side (client hashes
are not trusted), stored, and re-verified on download; mismatches are logged
and surfaced via the `X-Integrity-Verified` header.

**Session scope.** The Telegram MTProto session is only ever used by the
server. The web app and SDK authenticate against OmniCloud's own session
system, so revoking a browser session never touches the Telegram account,
and Telegram credentials never transit the frontend.

## Recommendations for operators

1. **Set `SESSION_SECRET`** to a long random value (`openssl rand -hex 32`) in production.
2. **Serve over HTTPS** (e.g. behind a reverse proxy) and set `COOKIE_SECURE=true`.
3. **Bind the API to localhost or a private network** if you do not intend it to be publicly reachable.
4. **Back up PostgreSQL** — it holds the only mapping between your drive structure and Telegram messages.
5. **Do not reuse** the Telegram api_id/api_hash across many automated deployments; Telegram enforces account-level limits.
6. Rotate/revoke the OmniCloud Telegram session by revoking the session in Telegram Settings → Devices if the server is compromised.

## Known v0.1 gaps (accepted for the MVP)

- No E2E encryption (planned post-v0.2; would require client-side key
  management that a plain web app cannot fully guarantee).
- No CSRF tokens: mutations rely on SameSite=Lax cookies and JSON-only
  content types; acceptable for v0.1, revisit for v0.2.
- Rate limiting is in-memory (single process) and only applied to auth
  endpoints.
- Upload/download buffers the whole file in memory (size-capped by
  `MAX_UPLOAD_MB`).
- The npm release workflow publishes with a repository secret; trusted
  publishing (OIDC) is configured as `id-token: write` and can be enabled
  on npmjs.com for a token-less flow.

## Reporting

Please report security issues privately to the maintainers (see the GitHub
repository's security policy) rather than opening a public issue.
