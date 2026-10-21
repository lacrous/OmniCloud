# Current Security Baseline

**Status:** Initial source-based baseline for E2EE design. Not an independent security audit or production configuration review.

**Companion report:** [`docs/audits/encryption-readiness-report.md`](../audits/encryption-readiness-report.md)

## Scope

This baseline records the current repository behavior relevant to a future end-to-end encrypted (E2EE) storage design. It is not a complete assessment of all application security controls. Findings below are based on the source paths listed and reviewed in the companion readiness report. Runtime deployment settings and secret values were not inspected.

## System boundaries

```text
Web / SDK / CLI
       │ authenticated API requests; file bytes are currently usable content
       ▼
OmniCloud API and core services
       │ Telegram client and storage references
       ▼
Telegram storage

PostgreSQL stores account/session data, drive metadata, operation state,
versions, and references needed to map files to Telegram objects.
```

The current architecture uses the API as the file-processing boundary. It is not an opaque-ciphertext-only service today.

## Observed protections and behavior

| Concern                  | Current behavior (source evidence)                                                                                                                                                                 | E2EE implication                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Web file upload          | Multipart upload sends the browser `File` to `/api/files` (`apps/web/src/api/upload.ts:40-53`).                                                                                                    | API receives usable file bytes.                                                             |
| API upload               | Multipart file is read/spooled and passed to core (`apps/api/src/routes/files.ts:49-65,74-91`).                                                                                                    | Server-side content processing is part of the design.                                       |
| Telegram upload          | Provider sends the buffer/path using GramJS `sendFile` (`packages/telegram/src/provider.ts:59-85`).                                                                                                | No client-side encryption at this boundary was identified.                                  |
| Download                 | API streams Telegram content to authenticated client and returns integrity/metadata headers (`apps/api/src/routes/files.ts:175-197`).                                                              | Server mediates file retrieval; client-side authenticated decryption was not identified.    |
| Integrity                | SHA-256 hashes are recorded and checked (`packages/core/src/services/file-service.ts:79-93`; `docs/security.md:135-143`).                                                                          | Detecting changed bytes is not confidentiality or a server-blind integrity guarantee.       |
| Telegram session at rest | SecretBox uses AES-256-GCM for Telegram session strings (`packages/core/src/utils/secret-box.ts:4-10,43-76`; `packages/database/src/index.ts:296-316`).                                            | Operator-managed secret encryption, not user-held file encryption.                          |
| Browser auth             | Opaque revocable cookie session, token hash stored server-side (`packages/core/src/services/auth-session-service.ts:5-10,42-70`; `apps/api/src/auth.ts:64-83`).                                    | Authentication does not imply encryption-key possession.                                    |
| API token auth           | Bearer-token support and token hash persistence exist (`apps/api/src/auth.ts:19-55`; `packages/database/prisma/schema.prisma:78-90`).                                                              | API access control does not conceal file bytes from the service.                            |
| Database metadata        | Schema includes user identity, Telegram references/session records, file/folder names, sizes, MIME types, hashes, and object IDs (`packages/database/prisma/schema.prisma:17-25,93-117,119-198`).  | Metadata is server-readable.                                                                |
| Web local state          | Local storage is used for UI preferences/theme; no browser crypto/IndexedDB key flow found in inspected Web source (`apps/web/src/hooks/useLocalStorage.ts:4-24`, `apps/web/src/lib/theme.ts:27`). | No web encryption key management was evidenced.                                             |
| SDK/CLI                  | SDK exposes storage operations and CLI configuration (`packages/sdk/src/client.ts`, `packages/sdk/src/cli.ts`).                                                                                    | No file encryption/key-management API was identified.                                       |
| Android                  | No Android app/package was identified in the inspected workspace.                                                                                                                                  | No Android E2EE behavior can be established.                                                |
| CI/release               | CI and release workflow files exist (`.github/workflows/ci.yml`, `.github/workflows/release.yml`).                                                                                                 | Existence does not establish signed provenance, reproducible builds, or E2EE test coverage. |

## Data classification (current)

- **File content:** Plaintext/usable by the API in the current upload/download path. It is not classified as E2EE.
- **Transport:** May be protected by TLS depending on deployment; transport encryption does not prevent the API endpoint from reading the content.
- **Telegram storage:** The inspected provider sends the content as a document. This report found no file-content encryption layer before storage.
- **Authentication credentials:** Browser/API tokens are hashed for persistence as implemented by their services. Telegram session strings may be sealed at rest with an operator-supplied key; the API can unseal them.
- **Metadata:** User identity, file/folder name, size, MIME type, hash, timestamp, version and Telegram object references are server-readable unless separately protected.
- **Logs and errors:** `docs/security.md` describes request/activity logging and secret filtering (`docs/security.md:135-150,227-235`). This baseline does not independently verify every log call or production logging destination.

## Existing engineering foundations

The codebase has upload operation state, idempotency, file versions, database transactions, spooling/streaming, ownership enforcement, a Telegram provider abstraction, and automated tests. These can support an incremental ciphertext-storage design. They do not themselves establish confidentiality against the server or provider.

## Limitations of this baseline

This was a code/documentation inspection, not a full source audit, production deployment assessment, live Telegram test, dependency provenance review, penetration test, or cryptographic review. It does not certify that all security controls work as documented. Revisit this baseline when implementation changes the content, metadata, key, or deployment flows.

## Baseline decision

As of this assessment, OmniCloud should be described as Telegram-backed cloud storage with application security controls, **not as end-to-end encrypted storage**. E2EE claims require demonstrated client-side encryption, a reviewed protocol and key lifecycle, cross-client interoperability, recovery behavior, and independent review appropriate to the final design.
