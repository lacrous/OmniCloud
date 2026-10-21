# E2EE Protocol and Key-Management Proposal

**Status:** Proposed architecture for focused design review. **Not approved, not a wire-format specification, and not implementation guidance for production cryptography.** No cryptographic primitives, serialization, or recovery protocol are finally selected here. Do not implement production encrypted objects from this document alone.

**Inputs:** [`encryption-readiness-report.md`](../audits/encryption-readiness-report.md), [`current-security-baseline.md`](current-security-baseline.md), [`threat-model.md`](threat-model.md), and [`encryption-requirements.md`](encryption-requirements.md).

## 1. Recommendation at a glance

Adopt a **client-side envelope encryption architecture** with:

- One random data-encryption key (DEK) per file version.
- A user root key (URK) that exists only on trusted clients or in user-controlled recovery material.
- A distinct key-encryption/wrapping key (KEK) derived from the URK with protocol-defined domain separation; use it only to wrap DEKs.
- A versioned encrypted-object format with independently authenticated chunks and a final authenticated manifest.
- A server-side record that carries opaque ciphertext and only the metadata needed for authorization, quotas, storage mapping, and operation recovery.
- Explicit encrypted vs legacy-plaintext object states; encryption is mandatory for an E2EE operation and no plaintext fallback is allowed.
- Existing-device-approved enrollment and an offline recovery code as the initial recovery model, subject to cryptographic design review and usability testing.

This architecture is preferable to password-derived file encryption or a server-held master key because login/password reset does not grant the server decryption capability, and password changes can rewrap a small root-key container instead of rewriting all files.

The exact algorithms, envelope schema, password-protection format, and enrollment message protocol remain to be chosen after library/platform evaluation and independent protocol review.

## 2. Proposed trust and data flow

### Upload of an encrypted object

1. The client authenticates to OmniCloud for account authorization. Authentication supplies no decryption key.
2. The client obtains its URK from an already-unlocked local session, trusted-device enrollment, or recovery procedure.
3. The client generates a fresh random DEK and unique file-version identifier.
4. The client encrypts the file using the approved chunked authenticated-encryption construction. It builds and authenticates a final manifest binding the chunks, count, order, size and file/version context.
5. The client wraps the DEK under a user key-wrapping key derived for this purpose, and encrypts selected file metadata locally.
6. The client sends ciphertext, the envelope, wrapped DEK and only the approved visible metadata to the API.
7. The API authorizes and stores opaque bytes through the existing operation/version/reconciliation path. Telegram receives ciphertext only for objects marked E2EE.
8. The client reports success only after the server confirms storage/commit and the client has received the expected operation result. Any server hash is treated as ciphertext transport/storage integrity, not proof that server content is safe or confidential.

### Download

1. The API authorizes access and returns object ciphertext plus envelope fields.
2. The client rejects unsupported versions/parameters before attempting decryption.
3. The client unwraps the DEK locally and authenticates/decrypts every chunk and the final manifest.
4. The client releases the complete plaintext file only after the manifest and all required integrity checks succeed. If streaming plaintext to an output is required, the UX/API must clearly define partial-output cleanup on late authentication failure.

### Server boundary

The API must not receive the URK, an unwrapped DEK, a password-derived wrapping key, or plaintext metadata selected for encryption. It may authenticate requests, enforce access and quotas, store ciphertext, track operation state, maintain the necessary file-object relationship, and report ciphertext size/state.

## 3. Proposed key hierarchy

```text
User recovery material (user-held, offline)
              │ protects / restores
              ▼
User Root Key (URK; random, client-held)
              │ purpose-separated derivation
              ├── File-Key Wrapping Key (KEK; client memory only)
              │       └── wraps one random DEK per file version
              ├── Metadata key (if metadata encryption is selected)
              └── Device-enrollment/authentication keys (if protocol requires)

Random per-version DEK
              └── encrypts/authenticates chunks + manifest for one version
```

Design constraints:

- URK MUST be generated from a CSPRNG, not from a password, username, email, Telegram ID, or server value.
- A fresh DEK is generated for each new file version. Replacing a file creates a new version and new DEK; never reuse the prior version's DEK for changed content.
- Derive purpose-specific keys from URK only through the selected reviewed KDF with unique, canonical context labels. The precise KDF, context encoding, and key sizes are unresolved pending library review.
- DEKs are wrapped using an authenticated key-wrapping/encryption construction. The envelope binds the wrapped key to account/key epoch, file ID, version ID and format version as authenticated context. The server may see the wrapped DEK, but it cannot unwrap it.
- URK is not sent to the OmniCloud API, Telegram, analytics, crash reporting, command-line arguments, or ordinary config files.
- Login credentials remain distinct. A password change updates local key protection and/or the URK container, not the content DEKs. Rewrap the URK container without rewriting file bodies when the cryptographic design permits.
- A new URK/key epoch requires a documented transition: either rewrap all DEKs through trusted clients or retain multiple key epochs in the envelope until rewrapping completes. Do not imply revocation of already copied keys.

## 4. Protecting the URK on clients

### Web

- Keep unlocked URK material in memory for a bounded session where practical; lock/clear on explicit logout and configured inactivity/background events.
- Do not persist raw URK/KEK/DEK in localStorage, IndexedDB, service-worker caches, URLs, or logs. Persistent encrypted key containers may be considered only after a reviewed local-protection design; browser-held password-derived containers do not protect against malicious delivered JavaScript.
- Treat the Web origin and build/release pipeline as trusted. A maliciously modified client can exfiltrate keys/plaintext. CSP and provenance reduce risk but do not eliminate that trust.
- Define preview, clipboard, downloads and browser cache behavior; plaintext can persist outside the key store.

### npm/CLI

- Prefer platform secure credential storage for an encrypted URK container; otherwise require an explicit, documented user-protected recovery/unlock workflow. Do not write plaintext keys in config files.
- Read passwords/recovery inputs through a terminal prompt or protected input channel, not command arguments or shell history.
- Provide explicit lock/logout/cache clear and redact sensitive values from diagnostics.
- Document that Node.js cannot guarantee complete zeroization of managed-memory copies.

### Android

- Protect a local device wrapping key using Android Keystore and, where available, hardware-backed facilities; encrypt a local URK container under the device key.
- Keystore device protection is not cross-device key transfer and does not create recoverability by itself.
- Explicitly decide backup/device-transfer exclusions, device authentication requirements, background unlock policy and temporary plaintext cleanup.

## 5. Recovery and trusted-device proposal

### Recommended initial model

Use two independent access paths:

1. **Trusted-device enrollment:** An already trusted device approves an enrollment request from a new device. The request displays a short authentication string/QR or equivalent transcript-binding value on both devices. The devices establish an authenticated end-to-end channel and transfer a protected URK container or the URK itself over that channel; the API relays messages but cannot decrypt them. Both devices display account and device identity, require user confirmation, bind the transcript to fresh nonces/device keys, and reject replay or mismatched identity. Exact key agreement, signatures, transcript format, and channel protocol require a separately reviewed design.
2. **Offline recovery code:** Generate high-entropy recovery material client-side, show it once in a human-exportable form with checksum/format version, and require the user to confirm they saved it. It encrypts or derives a recovery wrapping key that protects a copy of the URK. The server stores only the resulting opaque authenticated ciphertext and nonsecret format/salt parameters, if server backup is chosen. The code itself is never transmitted. Recovery requires account authentication plus the recovery code, but account authentication alone is insufficient.

Never implement QR as a bearer link that encodes the URK directly without authenticated, confidential, replay-protected device-to-device protocol design. Never let an API-issued login QR silently enroll a decryption device.

### Recovery semantics

- A password reset restores OmniCloud account access only; it does not restore the URK.
- Losing all trusted devices and recovery material means encrypted data is unrecoverable. Clearly explain this before encrypted storage is enabled and during recovery setup.
- Recovery code regeneration requires an unlocked trusted device or existing recovery material; it creates and verifies a new wrapped recovery record before the old record is retired.
- Test corrupted/incorrect recovery material, interrupted recovery, duplicate requests, replayed enrollment, device replacement, and recovery after account password reset.
- Recovery flow and entropy/format must receive usability and security review before adoption.

### Device revocation

Revoking a device blocks future authenticated API access and future enrollment approval, but cannot erase copied plaintext/keys. Immediate cryptographic exclusion of a device that already knows URK requires a key-epoch change and rewrapping file keys (and possibly new copies for material requiring stronger forward revocation). Define whether the first release provides server authorization revocation only or cryptographic key rotation. User interface must not imply that remote revocation erases local data.

## 6. Metadata privacy proposal

Recommended initial boundary for a manageable first protocol review:

- Encrypt filenames, folder names, descriptions, tags, and any user-created metadata that does not need to be read by the server.
- Keep account ownership, opaque object/file identifiers, ciphertext byte count, upload/version state, Telegram object reference, operational timestamps, quota accounting, and format version visible as needed for service operation.
- Do not store plaintext MIME type or content hash unless explicitly accepted as leakage; derive display MIME client-side from authenticated encrypted metadata. A ciphertext hash may still leak equality of identical ciphertext only if ciphertext/key reuse allows it, which the design should avoid; server hash remains useful for transport integrity but should be identified as ciphertext hash.
- Do not put original filenames, plaintext hashes, or user descriptions in Telegram captions. Use opaque identifiers and minimal operational data.
- Search over encrypted names/tags is not included in the first release. Client-side search can operate on decrypted metadata after authorized listing, with the cost of fetching metadata locally. Do not introduce deterministic searchable encryption without a separate threat analysis.

**Decision required:** validate which visible fields are acceptable for the product's privacy goals and whether client-side listing of encrypted metadata meets usability/performance requirements.

**Status (2026-10-21):** the first release implemented the content-encryption
boundary only — see the v1 limitations in
[`encryption-protocol-v1.md`](encryption-protocol-v1.md). One gap the caption
rule above does not cover: a Telegram document also carries a **filename
attribute**, taken from the upload's name, so the real name reaches the
channel even though the caption does not. The concrete design for opaque
names, the client-side index and client-side search is
[`architecture-decisions/0004-client-side-filename-index.md`](architecture-decisions/0004-client-side-filename-index.md);
it is not implemented.

## 7. Proposed object format layers (not final wire schema)

Separate the object into three conceptual layers:

1. **Clear routing header:** minimal version/algorithm identifiers and opaque object/version IDs needed to route and reject unsupported formats. Do not put secrets or plaintext names here.
2. **Encrypted metadata/key envelope:** authenticated encrypted metadata plus wrapped DEK and its key epoch/context. Server-visible fields must be enumerated.
3. **Ciphertext stream:** authenticated chunks plus final manifest that commits to the complete ordered stream and relevant file/version context.

Design review must determine canonical serialization, critical/noncritical extension behavior, algorithm negotiation policy (prefer a fixed approved profile per format rather than arbitrary server/client negotiation), maximum lengths, parser resource bounds, tag sizes, nonce strategy, chunk sizing, finalization, and rollback semantics. Protocol must not accept server-selected weaker algorithms or downgrade automatically.

A semantic file ID/version ID may be server-assigned after upload; therefore the protocol must decide whether these values are client-generated opaque identifiers or are bound after a reservation handshake. Do not invent this binding later: it affects retries and chunk associated data.

## 8. Chunking and resumability proposal

- Encrypt chunks independently with authenticated context that binds a unique file version, chunk index, format version and relevant immutable parameters.
- Choose and document a nonce strategy that guarantees uniqueness for every key even across process crashes/retries. Randomness, counters, or a reviewed streaming construction each have different requirements; choose only after library review.
- The client persists enough **ciphertext-only** state to resume safely, or can deterministically regenerate the same encrypted representation only if the construction permits doing so without nonce reuse hazards. Do not resume by re-encrypting changed source bytes under reused nonces.
- Final manifest authenticates total plaintext size, chunk count, order, finalization state and any protocol-defined digest/commitment. Clarify whether digest is over plaintext (privacy leakage) or ciphertext; prefer avoiding server-visible plaintext hashes.
- Client verifies manifest and all chunks before success. API upload completion/Telegram success is not equivalent to cryptographic completeness.
- Test lost response after chunk/object write, duplicate chunk upload, source mutation during resume, process restart, Telegram object ambiguity, final manifest failure, and version replacement.

No exact chunk encryption scheme is chosen by this proposal.

## 9. Legacy-object and rollout design

Persist an explicit object encryption state: `LEGACY_PLAINTEXT`, `E2EE_V1` (once a version is approved), and migration operation states such as `PENDING`, `UPLOADING_ENCRYPTED`, `VERIFYING`, `COMMITTED`, `FAILED_RECOVERABLE`. Exact enum/API names are implementation decisions.

Migration flow:

1. Client identifies the legacy version and obtains source content through existing authorized download.
2. Client encrypts locally with new version identity/key and starts a durable migration operation.
3. API stores ciphertext as a new candidate object, not yet replacing the active plaintext pointer.
4. Client retrieves the candidate ciphertext, authenticates/decrypts it and verifies equality to source locally.
5. Client/API commits the new encrypted version and state transactionally where possible; operation record supports restart/retry.
6. Retain original plaintext until user retention settings and verification allow deletion; no automatic deletion in the initial migration release.

Existing old file remains legacy until completed. Do not label a mixed folder/account wholly E2EE. Migration should be opt-in initially and report remaining legacy items. The non-atomic Telegram/DB delete/update boundary requires explicit compensation and crash recovery tests.

## 10. Compatibility strategy

- Preserve existing API routes where possible but make encrypted format/state explicit in response contracts and upload metadata.
- Existing clients continue to access legacy objects according to the compatibility policy; they must not claim those files are E2EE.
- Older clients that do not understand an encrypted object must receive an explicit unsupported-format error, never raw ciphertext presented as a normal file and never a plaintext fallback.
- Version records should independently carry encryption format/key epoch so versions can differ during migration.
- API authorization continues to protect object references; encryption is not a replacement for ownership checks.

## 11. Cryptographic library evaluation gate

Before deciding algorithms, compare candidate maintained libraries on:

- Reviewed security construction and independent audit history.
- Browser, Node.js, and Android implementations and shared test-vector support.
- Streaming/chunk API and authenticated finalization semantics.
- CSPRNG and nonce management obligations.
- Constant-time behavior and error handling where applicable.
- Key wrapping, KDF and password/recovery support without custom constructions.
- Package/native/WASM supply chain, release provenance and update cadence.
- Performance, peak memory, battery, binary size, and supported platform versions.
- License/maintenance and whether one implementation can be used safely across targets.

Deliver an ADR comparing candidates and a proof-of-concept interoperability test with no production data before any final choice. External cryptographic review must examine the proposed construction and actual API semantics, not merely library names.

## 12. Alternatives considered

| Alternative                                               | Benefit                                  | Reason not recommended as the default                                                                                                                               |
| --------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Derive every file key directly from account password      | Simple apparent onboarding               | Password changes, password entropy, offline guessing, and server authentication coupling create risky key lifecycle; no independent random root and recovery model. |
| Server-held master encryption key                         | Easy recovery and server-side processing | Server can decrypt; does not satisfy the objective.                                                                                                                 |
| One key for all user files                                | Fewer records and wrapping operations    | Larger compromise blast radius; rotation/revocation/version handling are poor.                                                                                      |
| Encrypt the whole file as a single in-memory buffer       | Simple format                            | Fails large-file memory requirements and safe resumability.                                                                                                         |
| Custom chunked AES-GCM design immediately                 | Familiar primitive                       | Nonce, finalization, reorder/truncation, resumption, and cross-platform semantics need reviewed construction; familiarity is not protocol review.                   |
| Device-to-device transfer via server-stored plaintext key | Easy implementation                      | Makes server compromise a key disclosure path.                                                                                                                      |
| Implement sharing in the first release                    | Broad feature set                        | Expands recipient/key revocation and link threats before single-user recovery is stable.                                                                            |

## 13. Proposed implementation sequence after approval

1. Review this proposal and approve/revise metadata visibility, recovery model, device revocation guarantees, and client platform scope.
2. Write architecture decision records for protocol format, primitive/library evaluation, serialization, chunking, key wrapping, and device enrollment/recovery.
3. Obtain focused external review of the protocol design before production cryptographic implementation.
4. Build non-production prototypes and cross-platform test vectors; no live user files and no production release format.
5. Implement protocol library/core with positive and negative vectors; review before backend integration.
6. Extend backend to preserve opaque ciphertext and explicit legacy/encrypted state while keeping existing reliability invariants.
7. Integrate SDK/CLI and validate true installation/runtime behavior; then Web with delivery limitations; separately decide Android architecture and implement conformance.
8. Add recovery/enrollment/revocation, migration and cross-platform failure tests before enabling encryption in any production workflow.
9. Perform independent implementation review, fix/retest findings, capture performance and operational evidence, and only then evaluate staged release readiness.

## 14. Decisions requiring approval

Before implementation, reviewers should explicitly decide:

1. **Metadata boundary:** Are names and folder labels encrypted in v1? Recommended: yes; keep only operational identifiers and ciphertext size visible.
2. **Recovery:** Is an offline high-entropy recovery code acceptable as a user responsibility, paired with approval by an existing trusted device? Recommended as a candidate, not finalized.
3. **Device revocation:** Does v1 promise only future API access revocation, or require cryptographic key rotation to exclude a revoked device from future versions? Historical copied content remains unrecoverable either way.
4. **Initial client set:** Which clients must interoperate for first encrypted beta? SDK/CLI + Web is the practical staged candidate; Android requires a committed implementation/testing plan before claiming cross-platform completion.
5. **Search:** Is client-side search over locally decrypted metadata acceptable initially, with no server-side encrypted search?
6. **Migration policy:** Keep plaintext originals until explicit user cleanup? Recommended yes for first rollout.
7. **Algorithm/library choice:** Must remain open until evidence-based comparison and cryptographic review; do not choose based on popularity alone.

## 15. Status

This proposal is a design artifact, not security approval. It does not resolve the exact protocol, primitives, envelope schema, chunk scheme, device-enrollment message protocol, or recovery encoding. Production cryptographic code, data migrations, releases, publication, and irreversible operations remain out of scope until explicit design approval and review.
