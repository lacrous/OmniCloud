# Post-audit remediation report

Baseline: `origin/main` at `654370f`, release 0.2.35. Work branch:
`post-audit-remediation`. Every finding below was checked against the source, and
each fix has a test that fails on the previous code.

This report covers the remediation work in progress. It is not a release
recommendation; see "Release gate" at the end.

## Method

For each reported finding: read the source, reproduce the defect with a focused
test, fix it, confirm the test fails on the previous code and passes on the fix,
then run the repository's own checks. Findings that could not be reproduced are
recorded as such rather than fixed speculatively.

## Findings and status

| ID   | Severity | Finding                                                                                                                                 | Status                   | Evidence                                                                                                                                                                                                                    |
| ---- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-1  | P1       | A failed version write left a file row pointing at a Telegram object the cleanup then deleted                                           | Fixed                    | Reproduced (`rows=1, objects=0`); `createWithFirstVersion` / `replaceWithVersion` write in one transaction. Test: `packages/core/test/atomic-commit.test.ts`. Real-PostgreSQL check: a failed commit rolls back with no row |
| R-2  | P1       | A failed cleanup of an orphaned object was discarded, so the leftover was invisible                                                     | Fixed                    | Reproduced (`objectsLeft=1, recordsLeft=0`); the leftover is recorded in the activity log with its message id. Test: `packages/core/test/cleanup-failure.test.ts`                                                           |
| R-3  | P1       | Two concurrent recoveries of one `UNKNOWN` operation committed two file rows for one object                                             | Fixed                    | Reproduced (`fulfilled,fulfilled`, `files=2, objects=1`); the claim result is now checked. Test: `packages/core/test/unknown-claim-race.test.ts`. PostgreSQL: two concurrent claims produce exactly one winner              |
| R-4  | P1       | A failure while marking an upload complete after the file was committed made the retry write a second file and a second Telegram object | Fixed                    | Reproduced (`files=2, objects=2`); the committed file id is recorded before the status change. Test: `packages/core/test/completion-failure.test.ts`                                                                        |
| R-5  | P1       | One lost response produced three Telegram objects under the production retry policy                                                     | Fixed                    | Reproduced (`putCalls=3, objects=3`); an ambiguous write is no longer retried by the engine. Test: `packages/telegram/test/upload-not-retried.test.ts`                                                                      |
| R-6  | P2       | SDK uploads and replacements sent no idempotency key, so a retry could duplicate server-side                                            | Fixed                    | Four tests in `packages/sdk/test/upload-idempotency.test.ts` and `upload-stream-memory.test.ts`; all fail on the previous code. The SDK also appended the file before `folderId`, which the server missed                   |
| R-7  | P2       | A `detach-dangling` action for a dangling upload operation changed nothing but was reported `applied`                                   | Fixed                    | Reproduced; it now reports a failure. Test: `packages/core/test/reconciliation-apply.test.ts`                                                                                                                               |
| R-8  | P2       | Adoption of an unknown object loaded the whole object into memory                                                                       | Fixed                    | Reproduced (`download` called, not streaming); the engine's new `hashObject` reads in chunks. Test: `packages/core/test/adopt-streaming.test.ts`                                                                            |
| R-9  | P2       | The dev database was published on every interface with a hardcoded password                                                             | Fixed                    | Tests: `apps/api/test/docker-compose-defaults.test.ts`. The compose file binds `127.0.0.1` and reads `POSTGRES_PASSWORD`; README, `.env.example` and `docs/deployment.md` updated                                           |
| R-10 | P2       | Five dependency advisories, two critical, in the `vitest` dependency tree                                                               | Fixed                    | `vitest` upgraded 3.2.7 to 4.1.11; the audit drops from five advisories to one low (`esbuild`, via `tsup`)                                                                                                                  |
| R-11 | P2       | The main CI job silently skipped the PostgreSQL integration tests                                                                       | Fixed                    | The migrations job already runs them (13 tests with the variable set). A new step fails the job when any test is skipped; verified to exit 1 with 8 skips and 0 with none                                                   |
| R-12 | P3       | Two tracked `.env.template-copy.*.bak` files with no values                                                                             | Fixed                    | Removed; `.gitignore` now excludes that pattern                                                                                                                                                                             |
| R-13 | P1       | Operations left in `COMMITTING` after a crash were expected to be stale                                                                 | Not reproduced as stated | The reproduction showed a different defect (R-4). No separate stuck-`COMMITTING` case was reproduced, so no change was made for it                                                                                          |
| R-14 | P2       | `resolveUnknown` does not check its claim result                                                                                        | Fixed as part of R-3     | The unchecked claim was the cause of R-3                                                                                                                                                                                    |

## Verification

Static, mock-based, and database-backed checks were run. No finding was verified
against a live Telegram account in this remediation, except the single caption
search performed earlier at 0.2.29, which is recorded in
`docs/phase-0-report.md`.

`docs/audits/test-evidence.md` records the exact commands and counts.

## Deep scan (later pass)

A second, multi-angle scan reviewed eight areas of the codebase: upload and commit
pipeline, storage engine and Telegram provider, API and security, web app,
database and migrations, SDK contract, reconciliation and integrity, and tests,
CI, deployment and docs. Each reported finding below was verified against the
source before any change.

| ID   | Severity           | Finding                                                                                                                                            | Status                                                                                                               |
| ---- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| S-1  | High               | An adopted object was created without a current version or version count, so it reported zero versions and its only version was treated as history | Fixed. Adoption uses the atomic create. Test: `packages/core/test/adopt-version.test.ts`                             |
| S-2  | High               | Emptying the trash removed only the current version's message, then deleted the version rows, stranding older versions' Telegram objects           | Fixed. Every version's message is removed first. Test: `packages/core/test/empty-trash-versions.test.ts`             |
| S-3  | High               | An object held by a `COMMITTING` upload was not protected from reconciliation, so it could be adopted as a duplicate                               | Fixed. `COMMITTING` is protected. Test: `packages/core/test/reconciliation-committing.test.ts`                       |
| S-4  | High               | `files.list({ folderId: null })` dropped the field, and the server reads an absent field as "any folder", so it returned files from every folder   | Fixed. The field is sent explicitly, matching `FoldersApi.list`. Test: `packages/sdk/test/files-list-folder.test.ts` |
| S-5  | High (unconfirmed) | The primary upload path ignores the result of its `COMMITTING` claim, which could let a follower commit a second file                              | Not confirmed. An injected claim failure still produced one file. No change made                                     |
| S-6  | Medium             | A failed activity write after the row is committed runs the orphan cleanup and deletes a live object                                               | Confirmed in source; not yet fixed                                                                                   |
| S-7  | Medium             | Search with file-only filters (`ext`, MIME, size) returns every folder, because the folder query ignores those filters                             | Confirmed in source; not yet fixed                                                                                   |
| S-8  | Medium             | `dangling` is decided by absence from a truncated listing, never verified with `stat`, and the report has no partial-scan flag                     | Confirmed in source; not yet fixed                                                                                   |
| S-9  | Medium             | A stalled `COMMITTING` operation is a dead end: no retry path can settle it and reconciliation does not surface it                                 | Confirmed in source; not yet fixed                                                                                   |
| S-10 | Low                | Missing FK-leading indexes (`Folder.parentId`, `File.folderId`) cause scans on folder and file deletion                                            | Confirmed in source; not yet fixed                                                                                   |
| S-11 | Low                | A QR status GET can issue a session cookie and is exempt from the Origin check, which is a login-CSRF shape                                        | Confirmed in source; not yet fixed                                                                                   |
| S-12 | Low                | The QR status poll shares a 10-per-minute limiter but polls every 2 seconds, so sign-in can time out                                               | Confirmed in source; not yet fixed                                                                                   |

S-1 to S-4 and S-7 to S-12 are fixed. S-5 and S-6 were not fixed, because
neither could be reproduced as described:

- **S-5** (primary upload path ignores its claim result): injecting a claim failure
  still produced exactly one file, so no duplicate was demonstrated and the hot
  path was left unchanged.
- **S-6** (a failed activity write deletes a live object): production passes
  `ActivityService`, whose `record` absorbs store failures by design, so the
  cleanup never runs after a successful commit. A guard test now pins that
  behaviour. The failure is only reachable if a caller injects a recorder that
  throws, which the application never does.

Later fixes:

| ID   | Fix                                                                           | Test                                                                                        |
| ---- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| S-7  | Search skips the folder query when the filters can only match files           | `packages/core/test/search-service.test.ts`                                                 |
| S-8  | The report carries `limit` and `truncated`; the route accepts a bounded limit | `packages/core/test/reconciliation-partial.test.ts`, `apps/api/test/reconciliation.test.ts` |
| S-9  | A crash-left `COMMITTING` operation can be reclaimed by a retry               | `packages/core/test/stuck-committing.test.ts`                                               |
| S-10 | Leading indexes on `Folder.parentId` and `File.folderId` (migration 7)        | Verified with `EXPLAIN`: both queries now use an index scan                                 |
| S-11 | The QR status route requires an allowed origin, since it can issue a session  | `apps/api/test/qr-login.test.ts`                                                            |
| S-12 | The QR status poll has its own 120-per-minute budget                          | `apps/api/test/qr-login.test.ts`                                                            |
| S-6  | Not reproducible; guard test only                                             | `packages/core/test/activity-failure.test.ts`                                               |

## Remaining risks and limitations

- The streamed upload path in the SDK (a stream or async-iterable input) still
  buffers into one Blob. This is deliberate: the source can be read once, so a
  retry needs the bytes. Spool-to-disk is not implemented.
- The search-error case for an `UNKNOWN` upload leaves the operation `UNKNOWN` and
  reports it; there is no automatic retry.
- Reconciliation scans are still capped, and partial scans are reported as such.
- Rate limiting remains per process and in memory.
- The remaining `esbuild` advisory is development-only.

## Release gate

Not satisfied. P1 findings in this report are fixed and tested, but the gate also
requires live Telegram verification, which has not been run for this work.
