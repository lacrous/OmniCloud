# Phase 0 exit report: audit and stabilization

Status as of OmniCloud 0.2.21 (`@lacrous/omnicloud@0.2.21` on npm).

This report records what the Phase 0 audit covered, what was fixed and released, what was
verified and how, and what remains open. It separates confirmed results from suspicions, and
it does not claim the system is fully correct.

## Audit coverage

| Area                                  | Method                                                                                    | Outcome                                                                                                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Upload idempotency and crash recovery | Read-only review, then reproduction on the in-memory repositories and a real PostgreSQL   | Six High findings. Four fixed (below); ambiguous Telegram writes still open                                                                                              |
| Telegram provider                     | Read-only review against the installed GramJS source, plus runtime checks of error shapes | Flood-wait values lost; some permanent errors retried as connection failures. Flood-wait and retry classification are **not yet fixed**                                  |
| Database lifecycle                    | Read-only review, then PostgreSQL checks                                                  | Folder deletes ordered wrongly (fixed); version numbers after pruning (fixed); folder restore and trash not atomic (open)                                                |
| Security                              | Read-only review of owner checks, sessions, logging, error bodies, filenames              | No cross-user access gap found, owner checks verified by reading. Filename bidi and control characters fixed                                                             |
| API and SDK contract                  | Read-only review, then tests that fail on the old behaviour                               | Replace sent empty bodies; retried stream uploads were sent empty; folder paging dropped; writes were retried automatically. All fixed. A behaviour change is documented |
| CI and release                        | Read of the workflows, then local reproduction of each new step                           | Real-PostgreSQL tests were skipped in CI (fixed); the release did not verify the packed package (fixed)                                                                  |
| Frontend                              | Read-only review, then code reading of the upload path                                    | Web upload retries sent no key, so a retry could duplicate a file (fixed). Destructive actions confirm before acting                                                     |
| Documentation                         | Compared environment variables, CLI flags and routes with the code                        | Undocumented QR and prune routes (fixed). The environment variable list and CLI flags match the code                                                                     |

Two early audit findings were wrong and were corrected by checking the code: the reconciliation
apply route is documented (under a combined heading), and destructive trash actions do confirm.

## Fixed and released

| Version | Fix                                                                                                               | How it was verified                                                                                                            |
| ------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 0.2.11  | Reconciliation reported a repair as applied when nothing changed                                                  | Test fails before the fix, passes after                                                                                        |
| 0.2.12  | Folder subtree delete and Trash emptying removed a parent before its children                                     | Reproduced against PostgreSQL (`ON DELETE RESTRICT`). The in-memory fake now enforces the same rule                            |
| 0.2.13  | File names could contain direction-override and zero-width characters                                             | Four tests fail before, pass after                                                                                             |
| 0.2.14  | Two requests with one upload key could each write a file record                                                   | Race test fails without the fix; the claim was checked on PostgreSQL                                                           |
| 0.2.15  | A new version after a prune could repeat a surviving number, so later replacements failed                         | Reproduced on PostgreSQL (duplicate-key error); regression test fails on the old logic                                         |
| 0.2.17  | A reused upload key with different content silently returned the old file                                         | Tests fail before, pass after; migration 5 applied to a clean PostgreSQL                                                       |
| 0.2.18  | Replacements ignored the upload key, so a retry created a second version                                          | Route tests fail before, pass after                                                                                            |
| 0.2.19  | SDK replace sent empty bodies; retried stream uploads were sent empty; folder paging dropped                      | Each has a test that fails on the old code                                                                                     |
| 0.2.20  | Real-PostgreSQL tests never ran in CI; the release did not verify the packed package                              | The CI step passed on GitHub's runner; the release step ran and passed for 0.2.20 and 0.2.21                                   |
| 0.2.21  | Web upload retries sent no key and could duplicate a file; QR and prune routes undocumented                       | Browser-shaped retry test; the no-key duplicate is shown by a test                                                             |
| 0.2.22  | A Telegram flood wait lost its delay; deleting an already-missing message failed                                  | Both reproduced through the library's own error mapping; tests fail without the fixes                                          |
| 0.2.25  | A lost Telegram response was recorded as `FAILED`, which a retry treats as safe to repeat                         | Test fails before, passes after; `UNKNOWN` is never claimed by a new request; checked on PostgreSQL                            |
| 0.2.24  | Folder restore made three non-atomic writes, so a failure could restore folders while their files stayed in Trash | Test fails on the old restore, passes now; atomic write checked on PostgreSQL across five fresh databases                      |
| 0.2.23  | Permanent Telegram errors retried; folder trash two writes non-atomic; folder delete orphaned old versions        | Each has a test that fails on the old code; atomic trash checked on PostgreSQL; 11 database tests pass on five fresh databases |

Also changed: the CI migrations job runs on the runner's own PostgreSQL instead of Docker Hub,
which had been rate-limiting pulls (PR #13).

## Behaviour changes users must know about

- **0.2.19:** the SDK no longer retries `POST` or `PATCH` automatically on 5xx responses. A
  write may already have been applied before the failure. Callers who depended on automatic
  write retries must retry themselves, and should use an idempotency key where the endpoint
  supports one.
- **0.2.17:** an upload key reused with different content is refused with `409`. Previously
  it was accepted and the old file returned.

## Verified how

- Unit and route tests run in the normal suite.
- Real-PostgreSQL tests run in CI, on a fresh database, after migrations apply and the schema
  diff is empty. Ten database tests pass there.
- Several claims were reproduced on a disposable PostgreSQL before fixing: the foreign-key
  rule, the duplicate version number, and the atomic claim.
- Releases were installed from the npm registry into a clean project and the `omnicloud`
  command and both module formats were checked, for 0.2.12, 0.2.13, 0.2.14, 0.2.15, 0.2.16,
  0.2.17, 0.2.18, 0.2.19, 0.2.20 and 0.2.21.

## Open items

These are known and not fixed. None is hidden.

**Upload correctness (Phase 1)**

- Ambiguous Telegram writes: a lost response can still store a second Telegram message. This
  needs a policy decision (see below). Not testable here without a real Telegram account.
- Upload and replace retries in the SDK are sent without a key unless the caller passes
  `operationId`.

**Telegram provider**

- All audited items are fixed (0.2.22, 0.2.23). Live behaviour of flood waits, permanent-error
  mapping and deletes against a real channel is unconfirmed.

**Database**

- Trash (0.2.23) and restore (0.2.24) are each one transaction.
- Some lists load unbounded result sets. Not a Phase 0 blocker; tracked for Phase 2.

**Security**

- Windows reserved device names are not rejected in file names. This matters only if names are
  written to a Windows filesystem.
- Log redaction covers top-level and one-level-deep keys only.

**Reconciliation and integrity**

- Scheduled integrity scans are not built, and retention is an operator action only. Both are
  deliberate and documented in `docs/limitations.md`.

**Not verified at all**

- Live Telegram behaviour of every path above (login, upload, download, deletion, flood waits).
- A real browser run of the upload path against a live account.
- macOS and Windows browser opening (only the command choice is tested).

## Decision needed

**Ambiguous Telegram writes.** When Telegram stores a message but the response is lost, the
server can't tell whether the upload happened. Choose one policy:

1. **Don't retry a timed-out upload automatically.** Mark it "outcome unknown", and let the
   client retry with a new key after checking. Safest; more manual work for the user.
2. **Look for the object before re-sending.** Search the channel for the same content before
   uploading again. Automatic, but depends on a Telegram search that cannot be tested here.
3. **Accept at-least-once and document it.** Keep retries; a lost response can duplicate a
   message. Simplest; users must accept an occasional duplicate.

## Exit criteria, as written in the roadmap

The roadmap's Phase 0 criteria asked for: every P0 issue fixed and verified; P1 fixed or
explicitly excepted; regression tests for each fix; existing failures classified; CI passing;
the production build passing; no known critical security or data-integrity issue unresolved;
and a clean release candidate.

Against those:

- **P0 issues:** none were found in the authentication or cross-user access audit. Data-integrity
  issues that were found are fixed or listed above.
- **P1 issues:** the ambiguous-write item is open, pending the decision above. The rest of the
  P1 list is fixed or listed as open.
- **Regression tests:** each fix has one, as tabled above.
- **CI and build:** passing on `main`.
- **Known critical or data-integrity issue unresolved:** ambiguous Telegram writes can create a
  duplicate message. This is the one item that blocks a clean exit.

**Phase 0 code work is complete except for one decision.** A lost Telegram response is now recorded
as `UNKNOWN` (0.2.25), and an unknown upload is never silently re-uploaded. What remains is how an
`UNKNOWN` upload is resolved: searching the channel, a user-initiated retry after checking, or
accepting a possible duplicate. That is a product choice that needs your decision.

Everything else the audit listed is fixed, tested, and released through 0.2.25.
