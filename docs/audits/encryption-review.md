# Independent cryptographic review — package and findings tracker

**Status:** package assembled; **no external review has taken place yet.** No document, UI string, or release note may claim "independently reviewed" until the exit criteria below are met and this file records the completed review.

**Purpose (plan M3):** an independent cryptographer or qualified review service examines the OCE1 design and implementation. This file is the single tracker for scope, hand-off contents, findings, fixes, and retests.

## Review scope

Requested review areas (in priority order):

1. **Protocol design** — OCE1 v1 envelope: versioning, suite selection, AAD binding (file id, version id, key epoch, chunk index, type bytes), chunked XChaCha20-Poly1305 construction, manifest/completion binding, nonce rules.
2. **Key hierarchy** — URK → HKDF (KEK / MEK) separation; per-file DEK wrapped under KEK; what the server can and cannot derive; password/reset paths that must not touch file keys.
3. **Recovery container** — recovery code (256-bit) → HKDF → wrapped-URK blob; misuse, code entropy, verification oracle risks, and the auth-recovery vs encryption-recovery split.
4. **Device enrollment design draft** — planned cross-device key transfer (design only; not yet implemented — reviewer should flag design flaws before M6 code).
5. **Implementation quality of `packages/crypto`** — constant-time concerns with the chosen libraries, key-material lifetime in JS, error taxonomy leaking oracle information, test coverage gaps.
6. **Migration and legacy handling** — verify-before-delete ordering, PENDING-resume hash check, plaintext-history retention rules (`docs/security/legacy-migration.md`).
7. **Metadata privacy boundary** — what v1 actually hides and what it does not. The protocol document was corrected on 2026-10-21 to state plainly that the plaintext filename is stored in `File.name` and is also carried by the Telegram document's filename attribute. The reviewer's task is to confirm that boundary as described is the correct one.
8. **OCE2, the server-blind filename format** — the design (`architecture-decisions/0004-client-side-filename-index.md`), the normative format (`encryption-protocol-v2.md`) and the implementation. `docs/audits/oce2-review-note.md` is the hand-off: it lists the decisions worth arguing with, what is deliberately not done, and the fact that **OCE2 is implemented but not enabled by default**. It stays that way until this review has returned findings on it.

Out of scope for this round: Android local storage (no client exists yet), sharing/permissions (not implemented), web supply-chain process (documented separately; reviewer comments welcome but not gating).

## Hand-off package

| Item                                                    | Path                                                                                |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Protocol specification (normative)                      | `docs/security/encryption-protocol-v1.md`                                           |
| Recovery & device-revocation design                     | `docs/security/recovery-and-device-revocation.md`                                   |
| ADR 0001 — platform & library evaluation                | `docs/security/architecture-decisions/0001-e2ee-platform-and-library-evaluation.md` |
| ADR 0002 — crypto stack                                 | `docs/security/architecture-decisions/0002-e2ee-crypto-stack.md`                    |
| Crypto implementation (all of it — small on purpose)    | `packages/crypto/src/`                                                              |
| Known-answer vectors + recovery KAT                     | `packages/crypto/test/vectors/v1.json`                                              |
| Vector & cross-client verification evidence             | `docs/audits/kat-vectors.md`                                                        |
| Live E2EE smoke evidence (29/29)                        | `docs/audits/live-e2ee-smoke.md`                                                    |
| Migration design                                        | `docs/security/legacy-migration.md`                                                 |
| Live migration evidence (14/14)                         | `docs/audits/m2-migration-smoke.md`                                                 |
| CLI encryption smoke evidence                           | `docs/audits/m4-cli-smoke.md`                                                       |
| Streaming large-file evidence (SDK, isolated process)   | `docs/evidence/streaming-memory.md`                                                 |
| Streaming large-file evidence (web, headless Firefox)   | `docs/evidence/web-streaming-bench.md`                                              |
| Threat model                                            | `docs/security/threat-model.md`                                                     |
| Three-tier execution plan                               | `docs/execution-plan.md`                                                            |
| Device-enrollment design (review scope item 4)          | `docs/security/architecture-decisions/0003-trusted-device-enrollment.md`            |
| Client-side filename index design (review scope item 8) | `docs/security/architecture-decisions/0004-client-side-filename-index.md`           |
| OCE2 hand-off note (review scope item 8)                | `docs/audits/oce2-review-note.md`                                                   |

All paths above were re-verified to exist on the branch named below.

### What was added since the first assembly

The package was first assembled at `bc87aeb` and has grown since. A reviewer
picking this up should know the following work landed afterwards and is **in
scope**:

- **M2 legacy migration** (`migrateFile` in `packages/sdk/src/encryption.ts`):
  inspect-first, verify-before-delete state machine. Review specifically the
  ordering guarantee and the PENDING-resume hash check.
- **M4 CLI** (`packages/sdk/src/cli-e2ee.ts`): secret-handling rules; confirm
  that no key material can reach argv, environment, or logs.
- **M5 streaming** (`encryptFileToSpool`, `uploadEncryptedStream`,
  `downloadDecryptedToFile`): the same OCE1 primitives driven incrementally.
  Review that the chunked path cannot silently diverge from the whole-file
  path — in particular `splitHeader` and the multipart envelope extraction in
  `packages/sdk/src/encryption.ts`, and the OPFS spool in
  `apps/web/src/api/encrypt-stream.ts`.
- **3.1 canonical origin**: not security-relevant, listed only so the snapshot
  matches the current tree.

### Reproducing everything

```bash
pnpm install
pnpm db:generate

# Crypto: unit tests plus the committed known-answer vectors.
pnpm --filter @omnicloud/crypto test
pnpm --filter @omnicloud/crypto run verify:vectors

# Cross-client agreement: Node and a real browser must match byte-for-byte.
# Needs firefox + geckodriver on PATH.
pnpm --filter @omnicloud/crypto run verify:vectors:cross-client

# SDK: includes the streaming E2EE suite and the memory-bound test.
pnpm --filter @omnicloud/sdk test

# Whole workspace gates, as CI runs them.
pnpm format:check && pnpm lint && pnpm typecheck && pnpm build && pnpm test
```

## Process

1. Engage an external cryptographer or independent review service; give them this repository (or a tagged snapshot) plus the table above.
2. Reviewer delivers findings with severity. Record each finding in the table below.
3. Fix all **high** and **medium** findings; retest; record evidence links.
4. Publish the review report under `docs/audits/` (or link the reviewer's public report).
5. Only after steps 3–4 may docs/UI use "independently reviewed" wording.

Snapshot to review: commit `7b237d3` or later on `Hilbras/OmniCloud` (record the exact reviewed commit here when the review starts).

## Findings

_None yet — no review has been performed._

| #   | Severity | Area | Finding                     | Status | Fix commit | Retest evidence |
| --- | -------- | ---- | --------------------------- | ------ | ---------- | --------------- |
| —   | —        | —    | (empty until review begins) | —      | —          | —               |

Severity model: **High** = breaks a stated security property (confidentiality/integrity of file content or keys); **Medium** = weakness that needs a fix before production E2EE wording; **Low** = hardening/documentation; **Info** = design feedback with no defect.

## Exit criteria (plan M3)

- [ ] External reviewer engaged; reviewed commit recorded above.
- [ ] Review report received and stored/linked.
- [ ] All high findings fixed and retested.
- [ ] All medium findings fixed and retested.
- [ ] This tracker's table reflects final states with evidence links.
- [ ] Wording gate opened: only then may docs/UI say "independently reviewed".
