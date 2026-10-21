# M2 — Live Legacy Migration Smoke Test

**Date:** 2026-10-18
**Status:** **14/14 checks passed** on the first execution. All results are _verified live_ against the running stack (real API process, real PostgreSQL, real Telegram storage).
**Runner:** `packages/database/scripts/live-migration-smoke.ts` (committed; re-runnable).

## Command

```bash
node --env-file=.env apps/api/node_modules/tsx/dist/cli.mjs \
  packages/database/scripts/live-migration-smoke.ts http://127.0.0.1:4001
```

Exit code 0 = every check passed. The runner drives the **real SDK `migrateFile`** (the same code the CLI/automation use) with an authenticated short-lived session, on disposable 150 KiB fixtures, and removes everything afterwards.

## Scenario 1 — Fresh single-version migration

| #   | Check                                                                                   | Result          |
| --- | --------------------------------------------------------------------------------------- | --------------- |
| 1   | API reachable                                                                           | PASS (HTTP 200) |
| 2   | Account with Telegram session + storage                                                 | PASS            |
| 3   | Fixture starts as legacy (`encryptionFormat=null`)                                      | PASS            |
| 4   | `migrateFile` → `migrated`, 0 plaintext remaining                                       | PASS            |
| 5   | File is `OCE1` after migrate                                                            | PASS            |
| 6   | **Plaintext predecessor removed** — versions = 1, encrypted                             | PASS            |
| 7   | **Migrated file downloads and decrypts byte-identical** to the original (153,600 bytes) | PASS            |

Proves the full pipeline: client-side encrypt → replace stored on Telegram → verification → prune of the verified plaintext twin.

## scenario 2 — PENDING resume (replace pre-committed, cleanup not done)

Simulates a crash after the encrypted replace by performing the replace directly, then calling `migrateFile`:

| #   | Check                                                                                  | Result |
| --- | -------------------------------------------------------------------------------------- | ------ |
| 8   | Pending state reached: OCE1 current + plaintext history (2 versions)                   | PASS   |
| 9   | **Resume verifies against the recorded sha256 and finishes** — `migrated`, 0 remaining | PASS   |
| 10  | Plaintext predecessor cleaned up — versions = 1, encrypted                             | PASS   |

The resume path never re-uploaded (it inspects first; the run's replace counter was not incremented for this file).

## Scenario 3 — Idempotent rerun

| #   | Check                                                                               | Result |
| --- | ----------------------------------------------------------------------------------- | ------ |
| 11  | Second `migrateFile` on the already-migrated file → `already_migrated`, 0 remaining | PASS   |
| 12  | No extra versions created (still 1)                                                 | PASS   |

## Cleanup

| #   | Check                                      | Result               |
| --- | ------------------------------------------ | -------------------- |
| 13  | Both test files removed from Telegram + DB | PASS (`remaining=0`) |
| 14  | Temporary session removed                  | PASS                 |

## Defects found

**None.** No product defect surfaced in this run; both script-level issues found during development (an import location, a response-shape helper) were fixed before the passing run.

## Not covered in this run

- **Failure injection on the live path** (corrupt Telegram object, network cut mid-replace): covered by SDK mock-server tests (`migration.test.ts`, 7 cases) but not exercised against live Telegram here.
- **Multi-version history files**: the mock tests cover the no-prune policy; the live run used single-version fixtures only.
- **Web UI action/menu/bulk flow**: browser-driven migration was not run in this pass; the Web shares the same algorithm and is gated by typecheck/lint/build. A manual browser pass remains open.
- **Plaintext filename exposure**: unchanged protocol-v1 limitation — migration does not hide names from the server.
