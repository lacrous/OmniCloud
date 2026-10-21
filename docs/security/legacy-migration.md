# Legacy File Migration — Design and Current State

**Status:** Implemented provisionally in the SDK and Web client; not independently reviewed. Companion to the roadmap's Phase 5. Security claims remain governed by [`encryption-protocol-v1.md`](encryption-protocol-v1.md).

## 1. Goal and non-goals

**Goal:** convert an existing plaintext ("legacy") file to OCE1 without data loss, without silent plaintext fallback, and without destroying version history.

**Non-goals (v1):** migrating every historical version in one pass (only the _current_ version is encrypted; history handling below), server-side migration jobs, and migration of Telegram _folder captions_ (filenames remain server-visible — see protocol v1 limitations).

## 2. Core algorithm (inspect-first and idempotent)

Both clients (`migrateFile` in `packages/sdk/src/encryption.ts`, `migrateLegacyFile` in `apps/web/src/api/migration.ts`) run the same state machine:

```text
inspect(file):
  current is plaintext                    → LEGACY
  current is OCE1, plaintext versions>0   → PENDING (an earlier run committed but did not finish)
  current is OCE1, no plaintext versions  → DONE

DONE                → return already_migrated
LEGACY (fresh run)  → download plaintext → encrypt in client → replace-with-encryption
                      → download candidate → decrypt → byte-compare with the plaintext in memory
                      → mismatch ⇒ MIGRATION_VERIFY_FAILED (nothing deleted)
PENDING (resume)    → download candidate → decrypt → SHA-256 vs the stored sha256 of the
                      newest plaintext version → mismatch ⇒ MIGRATION_VERIFY_FAILED
cleanup (after verify) → if exactly 2 versions with exactly 1 plaintext predecessor:
                      → versions/prune KEEP_LATEST_N count=0
                      multi-version files: NEVER pruned; remaining count reported
```

Returns one of `migrated`, `migrated_with_plaintext_history`, `already_migrated`, plus
`plaintextVersionsRemaining`.

### Why the two verification modes

- **Fresh run** holds the source bytes in memory and compares them directly — strongest, but not survivable across a crash.
- **Resume** cannot re-hold bytes that a crash destroyed, so it verifies against the _recorded_ SHA-256 of the plaintext predecessor (written by the server when that version was originally uploaded). Both modes are tamper-detection for the migration itself; neither trusts the server to hold secrets.

## 3. Deletion policy (why nothing is lost)

- The plaintext predecessor and the new encrypted version contain the **same content** once verification passes, so removing the plaintext copy after verification loses no versions — it is the same version's bytes under a different format.
- The plaintext copy is removed **only** when it is the sole historical version (total = 2, exactly 1 plaintext). Deleting it therefore erases no distinct point in history.
- Multi-version files keep all plaintext history. The result surfaces `plaintextVersionsRemaining`, and the UI reports it (e.g. “N older plaintext version(s) remain”). Per-version encryption of history is future work.
- **Nothing is ever deleted before verification succeeds.** A failed verification leaves every original intact and is safe to re-run.

## 4. Crash-recovery matrix

| Crash point                            | State on disk                             | Rerun behavior                                                          |
| -------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| During plaintext download / encryption | current still plaintext                   | Full fresh run; no side effects                                         |
| After replace, before verify           | current OCE1 + plaintext predecessor      | PENDING: sha256 verify → cleanup                                        |
| During/after prune                     | maybe plaintext predecessor still present | PENDING or DONE; prune is idempotent (removes 0 when nothing to remove) |
| After success                          | OCE1 only                                 | `already_migrated`; no uploads, no prunes                               |

No local durable state file is required: all resume information lives server-side (file format + version rows), so migration also survives browser/CLI restarts.

## 5. API surface used (no new endpoints)

| Step                     | Endpoint                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Inspect                  | `GET /api/files/:id`, `GET /api/files/:id/versions`                                                                                  |
| Source / candidate bytes | `GET /api/files/:id/download`                                                                                                        |
| Encrypted replace        | `POST /api/files/:id/replace` (four OCE1 text fields before the file part)                                                           |
| Cleanup                  | `POST /api/files/:id/versions/prune` `{ policy: "KEEP_LATEST_N", count: 0 }` (server guarantees the current version is never pruned) |

Idempotency: each replace attempt carries a fresh operationId; the inspect-first design means a rerun never double-commits (an already-committed run short-circuits to PENDING/DONE instead of replacing again).

## 6. User experience

- **Per-file:** item menu → “Encrypt file” (only for legacy files, only when a key is active) → confirmation explaining verify-then-delete semantics → progress via the mutation → toast with outcome, including how many plaintext history versions remain.
- **Bulk:** selection bar → “Encrypt” appears when the selection contains legacy files → same confirmation for N files → sequential processing (one file completes before the next) → summary toast (`Encrypted X`, failures reported with “failed files kept their plaintext copy”).
- **Indicators:** the existing Encrypted badge reflects `encryptionFormat` after the query refresh; legacy files remain visibly unencrypted until migrated.
- Missing key: the action refuses with “Generate or unlock an encryption key first” — never a plaintext substitute.

## 7. Test evidence

- **SDK:** `packages/sdk/test/migration.test.ts` — 7 cases: fresh single-version (prune invoked, plaintext gone), multi-version (no prune, history intact and reported), idempotent rerun, PENDING resume success (zero replace calls), resume hash mismatch (verify fails, nothing deleted), fresh-path corrupt candidate (verify fails, plaintext kept), and recovery-after-failed-verify.
- **Web:** flow is exercised through the same algorithm structure; web has no runtime test harness (gated by typecheck/lint/build). The **live check** below exercises the shared algorithm end-to-end.

## 8. Live verification

See [`../audits/live-e2ee-smoke.md`](../audits/live-e2ee-smoke.md) for the M1 pipeline proof; M2's live migration run is recorded in [`../audits/m2-migration-smoke.md`](../audits/m2-migration-smoke.md) once executed.

## 9. Honest limitations

- A failed verification is reported loudly; the file remains legacy until a later attempt succeeds. There is no automatic background retry.
- Multi-version files stay partially plaintext by design until per-version migration exists; “encrypted” UI badges reflect the _current_ version only.
- The plaintext filename still goes to the server (protocol v1 limitation); migration does not change that.
- Client memory during migration holds the whole file (streaming migration is part of the large-file work, roadmap plan M5).
- This design has not received independent review; see the plan's M3 gate.
