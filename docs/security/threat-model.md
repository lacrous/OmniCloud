# E2EE Threat Model — Draft for Review

**Status:** Proposed threat model for protocol design; not yet approved and not evidence that E2EE is implemented. This document describes intended properties for a future feature and the current baseline described in [`current-security-baseline.md`](current-security-baseline.md).

## 1. Purpose and security objective

Define what a future OmniCloud client-side encryption design should protect, what remains trusted, and what is explicitly out of scope. The intended property is that supported trusted clients encrypt file content before upload and decrypt only after retrieval, such that ordinary API, database, and Telegram storage operations do not require plaintext file keys.

This objective is not met by the current implementation. The current Web upload sends usable file bytes to the API, which sends them to Telegram (`../audits/encryption-readiness-report.md`).

## 2. System and trust boundaries

### Components in the target system

- **Trusted client software:** Web, SDK/CLI, and a future Android app. Each performs local encryption/decryption and protects user-controlled key material to platform capabilities.
- **OmniCloud API:** Authenticates and authorizes requests; enforces quotas; manages object references, versions, operation state and storage calls. Target E2EE design should make it unnecessary for this component to see plaintext files or unwrapped file keys.
- **PostgreSQL:** Stores account, authorization, object, operation and metadata records. Unless encrypted/opaque by design, database fields remain visible to the server/operator.
- **Telegram:** Stores uploaded objects and returns them through the provider. In the target design it should receive ciphertext for E2EE objects, not their plaintext source files.
- **Release and build systems:** Deliver client code and artifacts. For Web clients, the party able to change delivered JavaScript can potentially change key-handling behavior.
- **External software/dependencies:** Build tools, runtime dependencies, package registry, browser, operating system and Android platform.

### Trust boundaries

1. User device ↔ OmniCloud API (network and application boundary).
2. OmniCloud API ↔ PostgreSQL (database credentials and backups).
3. OmniCloud API ↔ Telegram/GramJS (provider account/session and remote storage).
4. Client source/build/release ↔ client artifact delivered or installed.
5. One trusted device ↔ another trusted device/recovery channel.
6. Encrypted object ↔ legacy unencrypted object and migration workflow.

## 3. Assets

- Plaintext file contents and decrypted previews.
- Per-file/per-version data-encryption keys (future design).
- User root/wrapping key material (future design).
- Recovery material and device-enrollment credentials (future design).
- Telegram MTProto session strings and Telegram account access.
- OmniCloud browser sessions and API tokens.
- Encrypted objects, manifests, and integrity/authentication tags.
- Account and drive metadata, including file/folder names, sizes, types, timestamps, hashes, identifiers, relationships and object references.
- Local caches, temporary files, downloads, logs, backups and crash/error reports.
- Client signing/release credentials, package provenance and distribution integrity.

## 4. Adversaries and threats considered

| Threat actor/event                                                 | Risk to assess                                                                                                                    | Desired control / limitation                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unauthorized API user                                              | Access to another account's object, metadata, or upload/download operations                                                       | Server-side ownership and authorization checks remain mandatory; cryptographic keys do not replace access control.                                                                                                                                 |
| Compromised/malicious API operator or process                      | Reads or alters uploaded/downloaded content; steals keys if clients send them; changes metadata or returns substituted ciphertext | Client-side encryption, authenticated format and fail-closed verification should prevent content disclosure/tampering without keys, subject to protocol and client correctness. Server can still deny service and observe exposed metadata.        |
| Database or backup compromise                                      | Reveals plaintext metadata, Telegram references, sessions if not properly protected, and object mappings                          | Minimize metadata; protect operational secrets and backups; encryption design must not rely on DB confidentiality for file content.                                                                                                                |
| Compromised Telegram account/channel/provider                      | Reads or replaces stored objects, deletes or withholds data                                                                       | Store ciphertext; authenticate content and manifest; maintain recovery/backups as needed. Availability and deletion cannot be guaranteed cryptographically.                                                                                        |
| Malicious or compromised Web deployment                            | Serves JavaScript that exfiltrates keys/plaintext                                                                                 | Treat the Web delivery origin/build pipeline as trusted for Web E2EE; mitigate with reviewed dependencies, CSP, controlled releases, provenance and optionally local/self-hosted client. These controls do not make a compromised origin harmless. |
| Malicious/compromised npm dependency or release                    | Executes code with SDK/CLI secrets and plaintext access                                                                           | Dependency review, lockfile/CI controls, release provenance/signing where feasible, auditable code and incident response.                                                                                                                          |
| Stolen/lost device or malware on an authorized device              | Reads keys/plaintext or copies files                                                                                              | Platform key storage, screen/device controls, minimal plaintext persistence, revocation and clear limits; malware with active user/device access can defeat client-side protections.                                                               |
| Password reset or account takeover                                 | Attacker authenticates without legitimate encryption key, or legitimate user loses access to keys                                 | Keep authentication separate from encryption-key recovery; do not transfer keys solely on account login/reset. Define independent recovery and enrollment.                                                                                         |
| Weak recovery or enrollment process                                | Unauthorized key transfer, social engineering, unrecoverable data loss                                                            | Explicitly authenticate peer devices and recovery material; test protocol and communicate irreversible loss risk.                                                                                                                                  |
| Replay, rollback, substitution, truncation, reorder, or corruption | Client accepts stale/partial/wrong file or metadata                                                                               | Versioned authenticated envelope, object/version binding, authenticated chunks and final manifest; define rollback limits and freshness source.                                                                                                    |
| Logging/telemetry/temporary-file leak                              | Exposes keys, plaintext, names or credentials                                                                                     | Secret-safe logging, privacy review, temporary-file cleanup, no key/credential telemetry; JavaScript memory zeroization cannot be guaranteed.                                                                                                      |
| Plaintext migration error                                          | Old unencrypted object deleted before encrypted copy is valid; silent fallback                                                    | Explicit legacy classification, idempotent states, ciphertext verification before pointer/deletion changes, recovery/retry plan.                                                                                                                   |

## 5. Security goals for a future E2EE release

1. Supported clients encrypt content before it reaches the API.
2. The API and Telegram storage pipeline handle opaque ciphertext and do not need unwrapped file keys for normal operations.
3. Clients authenticate encrypted content and reject wrong keys, altered envelopes, invalid tags, malformed manifests, and incomplete streams.
4. Each file/version has properly generated key material and key purposes are separated.
5. Authentication, authorization, encryption-key possession, enrollment and recovery are separate concepts.
6. Existing files are clearly classified as legacy/unencrypted until a verified migration finishes.
7. User-facing encryption indicators reflect completed, verified state rather than a requested or started operation.
8. Metadata exposure and search limitations are stated accurately.
9. Web, SDK/CLI, and Android implementations conform to one specified protocol with cross-platform vectors.
10. Security claims match tested behavior and documented limitations; external review status is stated honestly.

## 6. Non-goals and residual risks

E2EE cannot by itself protect against:

- Malware, a compromised OS/browser, keylogger, malicious browser extension, or an authorized client that is compromised while keys/plaintext are available.
- A malicious web origin that can replace the delivered client code; Web client security relies on delivery integrity and user trust in the code delivered.
- Denial of service, censorship, deletion, traffic analysis, or all metadata inference.
- Plaintext copies users export, share, screenshot, print, cache or back up outside the controlled client.
- Previously copied plaintext or keys on a device later revoked.
- Weak user passwords, unsafe recovery storage, or social engineering unless mitigated by protocol and user behavior.
- Bugs in cryptographic libraries, platform crypto, client implementation, or build/distribution chain.

The design must define visible metadata explicitly. Candidate server-visible values include ciphertext size, request timing, account/object identifiers, version count, timestamps, Telegram object references, and possibly file/folder names, MIME types and content hashes. Reducing visibility may affect indexing, deduplication, quotas, previews and abuse handling.

## 7. Required design decisions before implementation

- Which content and metadata fields are encrypted, and which remain visible?
- What is the versioned envelope and its canonical serialization?
- What reviewed primitives/libraries work across browser, Node.js and Android, and how are nonce/key uniqueness properties guaranteed?
- How are per-version file keys wrapped and rotated?
- How are trusted devices enrolled, authenticated, revoked and audited?
- What recovery method is supported, and what data loss occurs if all keys/recovery material are lost?
- How are encrypted chunks, final manifests, resumption, retries and completeness authenticated?
- How does file/folder search work when names or tags are encrypted?
- How are encrypted objects distinguished from legacy plaintext in APIs, UI, version history and migration state?
- What is the browser delivery model and what claims can be made about it?
- What test vectors, cross-platform tests, independent review, and release evidence are required before a production claim?

These decisions need architecture decision records and focused review before production cryptographic code is written. Do not treat the illustrative primitive suggestions in the roadmap as an approved protocol.

## 8. Validation and acceptance evidence

Before an E2EE production claim, require evidence that:

- API/Telegram integration tests observe ciphertext for encrypted uploads and no key material in request, database, logs or provider calls.
- Negative tests reject tampering, wrong keys, truncated/reordered/duplicated chunks, invalid manifests and unsupported required formats.
- Each supported platform can decrypt every other platform's fixtures and reject invalid fixtures.
- Recovery, enrollment, revocation, migration, interruption and restart paths are exercised.
- Large-file peak memory and performance are measured.
- Web, Android, dependency and release risks are documented and tested to the degree claimed.
- An independent review is completed; findings and fixes are recorded. A test suite is not a substitute for that review.

## 9. Status

This is a draft threat model derived from the initial source-based audit. It is not an approved protocol, security certification, or statement that the goals above are implemented. Update it as design decisions are reviewed and implementation evidence becomes available.
