# E2EE Requirements — Draft

**Status:** Design requirements for review. These requirements are not a protocol specification and do not authorize implementation of an unreviewed cryptographic format.

**Source audit:** [`docs/audits/encryption-readiness-report.md`](../audits/encryption-readiness-report.md)

## 1. Purpose and applicability

Define verifiable requirements for a future OmniCloud end-to-end encrypted storage capability across Web, npm/CLI, and Android. Apply these requirements to protocol design, clients, API/storage integration, migration, recovery, testing, documentation, and rollout.

The current application does not meet these requirements. Until the release gates below are satisfied, product documentation must not claim E2EE.

## 2. Core security requirements

### 2.1 Client-side confidentiality

- **ENC-001:** A supported E2EE client MUST encrypt file content before upload to the OmniCloud API.
- **ENC-002:** The OmniCloud API and Telegram provider MUST NOT require plaintext file content or unwrapped file-decryption keys for ordinary storage, versioning, reconciliation, or retrieval operations.
- **ENC-003:** Encrypted upload MUST fail closed if client encryption, key acquisition, format validation, or required cryptographic operations fail. It MUST NOT silently upload plaintext.
- **ENC-004:** Downloads MUST be authenticated and decrypted by a trusted client. A client MUST NOT report successful verification/decryption until the entire file and required manifest checks pass.
- **ENC-005:** Server-side hashing or HTTPS MUST NOT be represented as E2EE or as proof that the server cannot read content.

### 2.2 Protocol and format

- **FMT-001:** Define a platform-independent, explicitly versioned envelope before production objects are written.
- **FMT-002:** The envelope MUST identify the format version and required algorithm/parameter identifiers; bind file and version identity; encode encrypted content or chunk references; carry authenticated completion/integrity data; and include wrapped file-key material without exposing the unwrapped key.
- **FMT-003:** Unknown mandatory versions, malformed envelopes, invalid parameters, and unsupported mandatory algorithms MUST be rejected safely. Implementations MUST NOT guess a format or downgrade silently.
- **FMT-004:** Specify canonical serialization and publish interoperability test vectors and invalid vectors.
- **FMT-005:** Use established, maintained cryptographic libraries and reviewed constructions. No custom cipher, MAC, KDF, or ad hoc protocol is permitted.
- **FMT-006:** Final primitive and library selections MUST be supported by documented review of security properties, browser/Node/Android support, nonce constraints, performance, maintenance, and interoperability. The roadmap's candidate primitives are not automatically approved.

### 2.3 Key hierarchy and lifecycle

- **KEY-001:** Generate independent cryptographically random data-encryption keys for files or file versions according to the approved protocol.
- **KEY-002:** Do not derive file keys directly from usernames, email addresses, Telegram identifiers, predictable account fields, or login tokens/passwords without the approved password-based wrapping design.
- **KEY-003:** Separate key purposes for root, wrapping, file data, device, recovery, and future sharing use. Key derivation context/domain separation MUST be specified.
- **KEY-004:** Plaintext root and file keys MUST NOT be sent to the API/Telegram or written to databases, logs, analytics, crash reports, URLs, or telemetry.
- **KEY-005:** Specify key creation, wrapping, rotation, rewrapping, loss, backup, revocation, and destruction behavior before implementation.
- **KEY-006:** Authentication success MUST NOT be treated as possession of encryption keys. Account password reset MUST NOT imply encrypted-data recovery unless the approved recovery protocol provides the required key material.
- **KEY-007:** Define local key protection separately per platform. Document browser/runtime limitations; use OS-backed protection where available on Android; avoid secrets in process arguments and shell history in CLI workflows.

### 2.4 Chunking, streaming, and integrity

- **CHUNK-001:** Large files MUST be processed without requiring whole-file buffering on supported clients.
- **CHUNK-002:** Specify a reviewed authenticated chunk construction, unique nonce strategy, authenticated associated data, and binding to file identity, version, and chunk position.
- **CHUNK-003:** A final authenticated manifest MUST bind expected chunk count/order and required completion metadata, so truncation, reordering, duplication, substitution, and incomplete uploads are rejected.
- **CHUNK-004:** Resume/retry behavior MUST preserve the original cryptographic parameters and only reuse valid ciphertext chunks. Define safe behavior when source bytes change during a resumed operation.
- **CHUNK-005:** Test empty, small and large files; truncation; corruption; reorder; duplicate chunks; interrupted transfers; retry; finalization; low-memory operation; and complete-file verification.

### 2.5 Metadata and privacy

- **META-001:** Produce a field-by-field metadata visibility specification before implementation. Identify which account, file, folder, version, size, MIME, hash, timestamp, identifier, and Telegram reference fields remain visible to the API, database operator, and Telegram.
- **META-002:** If names, folder labels, tags, descriptions, or other user content are encrypted, define the corresponding listing/search/indexing behavior, update semantics, and metadata authentication.
- **META-003:** User-facing claims MUST distinguish content encryption from metadata privacy. Do not say “all metadata is private” unless demonstrated.
- **META-004:** Logs, error reports and analytics MUST exclude plaintext keys and file content. Minimize sensitive metadata and document required operational records.

## 3. Client requirements

### 3.1 Web

- **WEB-001:** Encrypt in the browser before upload and decrypt only after retrieval, using the shared approved protocol.
- **WEB-002:** Do not persist plaintext keys. Define key lifetime, local caches, IndexedDB, service workers, previews, downloads, clipboard, logout cleanup, and temporary content behavior.
- **WEB-003:** Document that a server capable of modifying delivered JavaScript may be able to steal keys/plaintext. CSP, dependency control, artifact provenance and self-host/local-client options are mitigations, not proof against a compromised delivery origin.
- **WEB-004:** Avoid unnecessary third-party scripts on key-handling pages; review content security policy and all key-accessing dependencies.

### 3.2 npm/CLI

- **CLI-001:** SDK operations MUST expose explicit encrypted/legacy status and encryption-aware upload/download behavior.
- **CLI-002:** If encryption is required by the caller or account policy and unavailable, fail explicitly; never fall back to plaintext.
- **CLI-003:** Use secure interactive prompts for secrets; do not put keys/passwords in command-line arguments, logs, or shell history.
- **CLI-004:** Provide explicit logout/key-cache clearing and document Node.js limitations on memory zeroization and secure storage.
- **CLI-005:** Test actual package installation and runtime compatibility before release claims.

### 3.3 Android

- **AND-001:** Android MUST implement the same protocol and pass the same canonical test vectors as Web and SDK/CLI.
- **AND-002:** Choose Kotlin/Compose or React Native only after validating crypto library behavior, Android Keystore support, background transfer and interoperability; document the decision.
- **AND-003:** Protect local key material with appropriate Android Keystore/platform facilities; state when hardware-backed security is unavailable.
- **AND-004:** Define handling of backups, device transfer, temporary plaintext, offline files, screen/background behavior, revocation, low storage/memory, process death, and resumable background operations.

## 4. API, storage, compatibility, and migration

- **API-001:** The API MUST distinguish encrypted objects, legacy unencrypted objects, and in-progress/failed migration states in persisted metadata and external contracts.
- **API-002:** Core and Telegram storage MUST treat encrypted payloads as opaque bytes while preserving existing ownership, quota, idempotency, retry, versioning, and reconciliation invariants.
- **API-003:** Keep object metadata updates transactional where possible; explicitly model recovery for non-atomic database/Telegram operations.
- **API-004:** Reject invalid or unsupported encrypted-object metadata safely; never reinterpret malformed ciphertext as plaintext.
- **API-005:** Do not break legacy file access without a documented and approved compatibility plan. Legacy status MUST be visible and MUST NOT imply encryption.
- **MIG-001:** Migration MUST run on a trusted client or explicitly trusted migration environment; encryption must precede upload of the encrypted copy.
- **MIG-002:** Verify encrypted content and metadata before changing the active pointer or deleting/releasing the original plaintext object.
- **MIG-003:** Migration MUST be idempotent, resumable, observable by status, and recoverable after process/network/database/provider failures.
- **MIG-004:** Preserve version history where feasible or clearly state unsupported behavior. Do not force irreversible migration without explicit user authorization and a tested recovery/rollback strategy.

## 5. Recovery, enrollment, revocation, and sharing

- **REC-001:** Specify and test recovery before broad production encrypted uploads. Recovery material MUST not be stored unrestricted on the API server.
- **REC-002:** Explain that losing all authorized key material may make encrypted files unrecoverable even when the user can recover account access.
- **DEV-001:** A new device MUST NOT receive decryption access solely because it authenticated to the account. Define an authenticated existing-device approval or reviewed recovery-based enrollment protocol.
- **DEV-002:** Define device identity, key transfer authentication, replay protection, user confirmation, auditability and failure behavior.
- **DEV-003:** Define revocation and its limits. Revocation cannot erase keys or plaintext already copied by a device. Determine whether future access requires key rewrapping or key-epoch rotation.
- **SHARE-001:** Sharing is out of scope until single-user encryption, recovery and device enrollment are stable, unless a separate reviewed design explicitly includes it.
- **SHARE-002:** If sharing is added, recipients must receive only intended file keys; server permissions or a normal URL MUST NOT silently confer decryption ability. Define revocation and link-secret exposure risks.

## 6. Verification requirements

- **TEST-001:** Unit and property tests MUST cover successful encrypt/decrypt and invalid keys, tags, ciphertext, envelope, format version and wrapped key data.
- **TEST-002:** Cross-platform matrix MUST cover Web↔Web, Web↔CLI, Web↔Android, CLI↔CLI, CLI↔Android, and Android↔Android for every supported format.
- **TEST-003:** Server tests MUST demonstrate that encrypted uploads deliver ciphertext to Telegram and no unwrapped file key to API request handling, PostgreSQL, logs or Telegram calls.
- **TEST-004:** Test authorization isolation, retries, duplicate requests, process restart, interrupted upload/download, database failure, Telegram ambiguity, replacement/versioning, reconciliation, migration failure, and missing/corrupted objects.
- **TEST-005:** Measure throughput and peak memory for representative small, large, and many-small-file workloads across supported clients/devices. Establish baselines; do not claim performance without measurements.
- **TEST-006:** Maintain test evidence that distinguishes automated results, manual tests, assumptions and untested conditions.
- **REVIEW-001:** Security-critical protocol and implementation MUST receive appropriate independent review before production E2EE claims. Record scope, findings, remediation and retesting. Tests do not replace review.

## 7. Documentation and user-facing behavior

- **DOC-001:** Document protocol version, key hierarchy, recovery, trusted devices, revocation, metadata visibility, legacy migration, browser limitations and known risks.
- **DOC-002:** UI MUST distinguish end-to-end encrypted, legacy unencrypted, migration pending/failed, corrupt/unauthenticated, and unavailable-key states.
- **DOC-003:** Show an encryption-success state only after the relevant encryption/upload/verification has completed.
- **DOC-004:** Do not describe a file as encrypted merely because it used HTTPS or is stored in Telegram.
- **DOC-005:** Keep marketing claims bounded to demonstrated properties; do not use absolute guarantees such as “impossible to hack” or “100% anonymous.”

## 8. Proposed release gates

An E2EE release is not ready until all applicable gates are evidenced:

1. Protocol and metadata policy reviewed and approved, with canonical vectors.
2. Key hierarchy, enrollment, recovery, revocation and migration specified and tested.
3. API and Telegram integration demonstrably store ciphertext without file keys.
4. Supported clients encrypt before upload and interoperate in both directions.
5. Large files stream, resume safely, and authenticate complete manifests.
6. No silent plaintext fallback; legacy objects are clearly identified.
7. CI, security tests, performance evidence, documentation and user indicators pass.
8. Web/Android/supply-chain/deployment residual risks are documented honestly.
9. Independent review findings are addressed and retested.
10. Release artifacts and source provenance match only the guarantees actually demonstrated.

## 9. Status and change control

These requirements are a draft based on the initial readiness audit and the project roadmap. They do not establish that any requirement is implemented, independently reviewed, or approved. Amend them through design review before coding; track accepted deviations and unresolved risks explicitly. Do not use this document alone as a release authorization.
