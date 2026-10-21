# Encryption Readiness Report

**Scope:** Initial repository audit for client-side end-to-end encryption (E2EE) readiness. This is a source-based readiness assessment, not a cryptographic audit, penetration test, or release approval.

**Current conclusion:** OmniCloud is **not ready to ship E2EE**. The current storage pipeline is server-mediated and handles file contents in usable form. Files are uploaded to Telegram as ordinary document bytes, while PostgreSQL holds file metadata and Telegram object references. The existing AES-256-GCM helper protects Telegram session strings at rest; it does not encrypt user files. No client-held file-key hierarchy, encrypted file envelope, client-side file encryption, device enrollment, or encryption recovery flow was identified in the inspected paths.

This conclusion is based on the code paths and searches listed below. It does not assert that every line of the repository or every runtime configuration was exhaustively audited. No live Telegram account or production deployment was tested for this report.

## Executive summary

| Area                        | Observed state                                                                                                             | E2EE readiness                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Web file upload             | Browser sends the selected `File` as multipart data to the API                                                             | Not E2EE                                               |
| API file path               | API accepts and spools uploaded bytes; streams downloads back                                                              | Server can access file content                         |
| Telegram provider           | Sends document bytes and retrieves them as buffered or streamed content                                                    | No client-side encryption at this boundary             |
| File metadata               | Names, sizes, MIME types, hashes, Telegram references, folders, and user/account fields are server-side                    | Visible to API/database operators                      |
| Existing at-rest encryption | AES-GCM SecretBox is applied to Telegram session strings                                                                   | Does not protect file content or make the server blind |
| SDK/CLI                     | Storage API, bearer token, upload/download and environment configuration; no encryption/key API found                      | Not E2EE                                               |
| Web local security          | UI preferences/theme use localStorage; no browser crypto or IndexedDB encryption flow found in inspected source            | No web key management identified                       |
| Android                     | No Android application/package was identified in the workspace inventory                                                   | Not currently evidenced as implemented                 |
| Recovery/device enrollment  | No user-controlled root key, recovery, or trusted-device protocol identified                                               | Blocking design gap                                    |
| CI and tests                | Existing reliability, authorization, database, streaming, and release workflows; no E2EE interoperability tests identified | Useful foundation, insufficient for E2EE readiness     |

**Recommended decision:** Do not describe the current product as E2EE or claim that the server cannot access files. Start with a protocol and threat-model design review; only then implement the shared protocol incrementally. Preserve the current storage architecture where possible by carrying opaque ciphertext through its existing upload, storage, versioning, and download operations.

## Scope and method

This pass inspected workspace structure, repository guidance, security documentation, package scripts, and source paths for the Web, API, core services, database, Telegram provider, SDK/CLI, CI/release, and relevant tests. It used source inspection and repository search, not an external review or production test. No `AGENTS.md` was present. `.env` was not inspected.

A source search that finds no browser encryption or Android implementation is evidence only for the inspected tree and patterns; it is not a formal proof of absence. The repository's own security documentation independently states that E2EE is not implemented (`docs/security.md:5-21`).

## Current architecture and data flow

### Upload

1. The Web client sends the browser `File` in multipart form data to `POST /api/files` (`apps/web/src/api/upload.ts:40-53`); the upload queue calls this helper (`apps/web/src/hooks/useUploads.ts:5,134`). Replacement uses `/api/files/:id/replace` (`apps/web/src/api/upload.ts:109-115`).
2. Fastify multipart has configured file/part limits (`apps/api/src/app.ts:50-53`). The file route obtains the multipart file, spools content, and calls the core service (`apps/api/src/routes/files.ts:49-65,74-91`).
3. Core accepts a `Buffer` or spooled file and calculates/uses SHA-256 and size (`packages/core/src/services/file-service.ts:45-59,79-93`). The upload service performs idempotency and operation-state handling (`packages/core/src/services/file-service.ts:103-160`).
4. The Telegram provider sends a document through GramJS from the buffer/path (`packages/telegram/src/provider.ts:35-43,59-85`). No client encryption is part of the inspected flow. Core computes a hash over the content; hashing is integrity metadata, not confidentiality.

### Download

The Web client links to `/api/files/:id/download` (`apps/web/src/api/client.ts:327-333`; UI call sites include `apps/web/src/components/DriveLayout.tsx:120` and `apps/web/src/pages/DrivePage.tsx:97`). The API streams retrieved content and exposes stored content type, size, SHA-256, and filename-related headers (`apps/api/src/routes/files.ts:175-197`). Telegram retrieval supports buffered and chunked paths (`packages/telegram/src/provider.ts:133-213`). The inspected route verifies content integrity; it does not decrypt an E2EE envelope.

### Database and metadata

The Prisma schema stores Telegram user identity details and browser session records (`packages/database/prisma/schema.prisma:17-25,38-54`), Telegram session strings (`:93-102`), Telegram storage identity/reference fields (`:103-117`), files with names, sizes, MIME types, hashes, and Telegram message IDs (`:146-179`), and version metadata (`:181-198`). Folder names and other drive metadata are also persisted (`:119-145`). Consequently, these values are visible to the application/database unless separately transformed. No encrypted metadata protocol was found.

### Authentication and existing encryption

Browser sessions are opaque, revocable tokens whose hash is stored server-side; API auth supports the browser cookie and bearer API tokens (`packages/core/src/services/auth-session-service.ts:5-10,42-70`; `apps/api/src/auth.ts:19-55,64-83`). This is authentication, not proof of possession of file decryption keys.

`packages/core/src/utils/secret-box.ts:4-10,12-76` implements versioned AES-256-GCM sealing for values at rest and specifically describes Telegram session strings. The database adapter applies it to Telegram session strings (`packages/database/src/index.ts:296-316`). This is server-managed encryption of an operational credential; the server has the configured key and can open it. It is not client-side file encryption. Its operator-secret derivation is documented in that helper (`secret-box.ts:92-109`).

The existing security page explicitly says “End-to-end encryption — Not implemented” and that Telegram can technically read channel content (`docs/security.md:5-21`). This is consistent with the observed file flow.

### SDK, CLI, and web client

The SDK exposes bearer-token configuration and file upload/download APIs (`packages/sdk/src/client.ts:49-60,83-94,224-251,550`). The inspected upload interface does not expose file-key or encryption-envelope operations. The CLI reads environment variables or a `.env` file as operational configuration (`packages/sdk/src/cli.ts:16-29,59-84`); that is not a user-controlled encryption-key system.

The Web API client uses same-origin credentials (`apps/web/src/api/client.ts:120-128`). Inspected Web source uses localStorage for UI preferences and theme (`apps/web/src/hooks/useLocalStorage.ts:4-24`, `apps/web/src/lib/theme.ts:27`, `apps/web/src/components/ThemeToggle.tsx:51`). Search found no `crypto.subtle`, IndexedDB, or browser-side encryption flow in the inspected Web source. The server-delivered JavaScript threat remains a fundamental Web E2EE concern even after client-side encryption is added.

No Android app/package was identified in the inspected workspace. The current repository therefore provides no evidence of an Android client or cross-platform encryption implementation.

## Classification of current content handling

- **File contents:** Plain bytes are supplied to the OmniCloud API, processed by core, sent to Telegram as document data, and returned through the API. At-rest encryption of Telegram content was not identified in the inspected pipeline.
- **Transport:** Network transport security depends on deployment (for example HTTPS and proxy configuration). HTTPS protects transport links, not server-side access, and is not E2EE.
- **Integrity:** SHA-256 is computed and checked by the server. This detects some corruption but does not prevent the server from reading or changing content before recomputing metadata.
- **Telegram session strings:** Server-side encrypted at rest when the configured SecretBox key is available; legacy unsealed values are accepted by the database adapter. This does not apply to file bytes.
- **Authentication tokens:** Browser session token hashes and API token hashes are stored, rather than the corresponding token secrets, as described by the auth implementation/schema. Authentication remains separate from file confidentiality.
- **User/file metadata:** Server-readable PostgreSQL fields include account identifiers, names, sizes, MIME types, hashes, folder references, timestamps, and Telegram references. Operational logs and API headers may expose selected identifiers and integrity metadata as documented in `docs/security.md:135-150,227-235`.
- **End-to-end encryption:** Not implemented in the inspected client/API/storage path.

## Reusable foundations

The repository has useful pieces that should be retained rather than rewritten:

- Existing upload operation state, idempotency, versioning, and transactional commit patterns (`packages/core/src/services/file-service.ts`; schema and migrations under `packages/database/prisma/`).
- Buffer and spool-based file handling plus streaming download paths, which can carry ciphertext and support large-file processing.
- A provider abstraction around Telegram storage (`packages/telegram/src/provider.ts`).
- Existing authentication and ownership checks; these can authorize encrypted-object operations without holding decryption keys.
- Existing SDK and Web upload/download contracts, which can be extended with explicit encrypted-object metadata while preserving legacy compatibility.
- Existing tests for authorization, idempotency, retries, streaming, integrity, and database behavior.

The safest initial integration target is a versioned opaque ciphertext object plus explicit encryption metadata, while retaining existing operation identifiers, storage abstraction, and failure/reconciliation semantics. Whether metadata fields need schema changes must be determined during protocol design.

## Main readiness gaps and risks

1. **No client-side encryption boundary:** plaintext reaches the API. This is the primary architectural blocker.
2. **No versioned ciphertext envelope:** existing file records model conventional name/size/MIME/hash and Telegram message references, not a specified crypto format.
3. **No user-held key hierarchy:** no root key, per-file key wrapping, key derivation protocol, or key-version lifecycle was identified.
4. **No key recovery or multi-device enrollment:** password reset/account login cannot safely substitute for possession of encryption keys. Data-loss risk cannot be assessed until a recovery protocol is designed.
5. **Metadata privacy is not defined:** filenames, folder names, sizes, MIME types, hashes, account/Telegram identifiers, and timestamps are stored in readable form. The product must explicitly choose which remain visible.
6. **Chunk encryption is unspecified:** streaming storage exists, but no authenticated chunk format, nonce rules, manifest, anti-reordering/truncation checks, or resume semantics exist for encrypted objects.
7. **Legacy objects need explicit classification:** existing unencrypted files must remain distinguishable and must not silently be called encrypted. Migration needs verified-copy-before-delete behavior and recovery for non-atomic Telegram/database steps.
8. **Web delivery risk:** a server that can alter JavaScript can potentially steal browser-held keys. CSP, dependency controls, release provenance, self-host/local-client options, and accurate documentation are needed; none alone proves safety.
9. **Cross-platform client gap:** no shared protocol/test-vector package or Android implementation was identified. Independent implementations risk incompatibility unless a protocol specification and interoperability vectors come first.
10. **Supply-chain/release verification:** CI and a release workflow exist (`.github/workflows/ci.yml`, `.github/workflows/release.yml`), but this audit did not establish signed provenance, reproducible builds, or independent artifact verification. Their actual guarantees need a separate release-integrity review.
11. **Security review is not cryptographic review:** existing security documentation records application hardening and prior findings, but no independent protocol or crypto implementation review was evidenced here.

## Proposed protocol and key-management direction (for design review, not implementation)

The following is a proposed starting point only; it is not an approved protocol and no cipher/format choice should be treated as final until evaluated and reviewed.

- Specify a versioned, platform-independent envelope and test vectors before clients write production objects. It should identify format/algorithm versions, file/version identity, encrypted content or chunk manifest, authenticated metadata, and wrapped file-key material. Unknown mandatory versions and malformed envelopes must fail closed.
- Generate an independent random data-encryption key for each file version. Encrypt content on the trusted client before upload. Wrap that key under a user-controlled key hierarchy; never upload the unwrapped key or root key.
- Define distinct key purposes for account root, wrapping, file data, device protection, recovery, and any later sharing. Use maintained platform/library implementations of reviewed primitives; select exact primitives only after reviewing interoperability, browser/Node/Android support, nonce constraints, and large-file behavior. Do not implement custom crypto.
- Design recovery and trusted-device enrollment before enabling encrypted uploads broadly. A new authenticated account session alone must not authorize key transfer. Recovery must be user-controlled and must clearly warn that losing all authorized devices and recovery material can make content unrecoverable.
- Decide explicitly which metadata remains server-visible and how file/folder listing and search work if names/tags are encrypted. Do not claim full metadata privacy if operational fields remain visible.
- Specify an authenticated chunk format and final manifest that bind file identity, version, chunk positions/count, and completion. Define safe nonce uniqueness, resume/retry behavior, and detection of reordering, duplication, truncation, and corruption before implementation.
- Keep legacy files explicitly marked unencrypted. A migration should encrypt on a trusted client, verify the ciphertext copy, atomically update metadata as far as possible, then apply user retention policy to the original; it must be resumable/idempotent and never silently fall back to plaintext.

## Recommended implementation order

1. **Design review:** finalize threat model, visible metadata policy, protocol envelope, cryptographic library/platform decision, key hierarchy, recovery/enrollment/revocation, chunking, and legacy migration. Record decisions in architecture decision records.
2. **Protocol conformance core:** implement only after design approval; publish canonical test vectors and negative tests before wiring to storage.
3. **Backend opaque-object support:** add explicit format/state metadata and ensure upload/version/download/reconciliation treat ciphertext opaquely, preserving current transactions and idempotency. Add tests proving the server never needs keys and malformed formats fail safely.
4. **SDK/CLI client:** first demonstrate encrypted upload and verified download plus recovery in executable cross-platform test workflows; no plaintext fallback when encryption is required.
5. **Web client:** integrate the same protocol with browser-appropriate key handling, CSP and supply-chain controls, and a clearly documented server-delivered-code limitation.
6. **Android decision and implementation:** choose native Kotlin/Compose or React Native based on verified cryptographic/Keystore/background-transfer support; do not start a divergent format.
7. **Legacy migration and staged rollout:** test on disposable data, classify legacy state in UI/API, use verified-copy-before-delete, and roll out gradually without irreversible migration.
8. **Independent review and release gate:** obtain an appropriate external protocol/implementation review, fix and retest findings, record actual cross-platform and performance evidence, and validate release provenance before any E2EE production claim.

## Evidence gaps / follow-up work

- This report did not run the full test suite, inspect every source file, probe a live Telegram account, review production deployment settings, or test an Android client.
- It did not inspect secret values or `.env`.
- It did not assess whether the current code has additional non-E2EE security defects beyond those documented in the existing remediation/audit reports.
- It did not verify current npm publication provenance or the effective signing/reproducibility properties of the release workflow.
- No independent cryptographic review or penetration test was performed.

These items should be addressed in their relevant phases, not assumed complete.

## Readiness decision

**E2EE production readiness: Not ready.** The current system is useful as a Telegram-backed storage application with documented application-security controls, but file confidentiality from the OmniCloud server and Telegram is not provided. The work can proceed without a rewrite: retain the storage/API reliability foundations and introduce a reviewed, versioned client-side encryption protocol at the client boundary. The next approval gate should be the protocol/key/recovery design—not production cryptographic code.

### Implementation progress (2026-10-17)

A provisional client-side encryption protocol (OCE1) has since been specified and implemented: shared crypto package with known-answer vectors, opaque-field API/database integration, SDK encrypted upload/download, and an opt-in Web flow. The readiness verdict above is **unchanged**: OCE1 is unreviewed, has no recovery/device enrollment, no Android client, and keeps server-visible filenames in v1. See [`docs/security/encryption-protocol-v1.md`](../security/encryption-protocol-v1.md) for the authoritative format, limitations, and remaining release gates.

## Sources

- `docs/security.md`
- `docs/audits/post-audit-remediation-report.md`
- `apps/web/src/api/upload.ts`, `apps/web/src/api/client.ts`
- `apps/api/src/app.ts`, `apps/api/src/routes/files.ts`
- `packages/core/src/services/file-service.ts`, `packages/core/src/utils/secret-box.ts`
- `packages/database/src/index.ts`, `packages/database/prisma/schema.prisma`
- `packages/telegram/src/provider.ts`
- `packages/sdk/src/client.ts`, `packages/sdk/src/cli.ts`
- `.github/workflows/ci.yml`, `.github/workflows/release.yml`
- Relevant tests under `apps/api/test`, `packages/core/test`, `packages/database/test`, `packages/sdk/test`, and `packages/telegram/test`

Line references correspond to the inspected worktree at report creation time.

---

This readiness report is source evidence and planning. It is not a guarantee, audit certification, or approval to release E2EE.

**Report status:** Initial readiness assessment complete; protocol design and independent review remain outstanding.

Additional baseline artifacts requested by the roadmap (`docs/security/current-security-baseline.md`, `docs/security/threat-model.md`, and `docs/security/encryption-requirements.md`) should be prepared as dedicated design deliverables after this initial audit has been reviewed, so the project does not accidentally present a proposed threat model or protocol as already approved.
