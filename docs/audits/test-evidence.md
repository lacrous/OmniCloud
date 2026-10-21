# Test evidence

Commands and results from the post-audit remediation, run on branch
`post-audit-remediation` (baseline `654370f`, release 0.2.35).

## Repository checks (after every stage)

| Command                  | Result          |
| ------------------------ | --------------- |
| `npx prettier --check .` | Pass            |
| `pnpm lint`              | Pass            |
| `pnpm typecheck`         | Pass (0 errors) |
| `pnpm test`              | Pass            |
| `pnpm build`             | Pass            |

Unit test counts on the final stage:

| Package  | Tests                                 |
| -------- | ------------------------------------- |
| shared   | 14 passed                             |
| core     | 261 passed, 1 skipped                 |
| database | 5 passed, 8 skipped (PostgreSQL-only) |
| telegram | 35 passed, 1 skipped                  |
| sdk      | 63 passed                             |
| api      | 127 passed                            |

The 8 skipped database tests run in CI's migrations job, where
`OMNICLOUD_TEST_DATABASE_URL` is set; see below.

## Reproduction of each finding

Each defect was reproduced before the fix, using the repository's own test
runner. The counts are from the reproduction run:

| Finding | Reproduction result before the fix                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------- |
| R-1     | `PARTIAL rows= 1 objects= 0` — a file row left with no stored object                                 |
| R-2     | `CLEANUP objectsLeft= 1 recordsLeft= 0` — an orphan with no record                                   |
| R-3     | `RACE results= fulfilled,fulfilled files= 2 objects= 1` — two files for one object                   |
| R-4     | `COMPLETEFAIL first= err … retry= ok files= 2 objects= 2` — duplicate after a failed completion      |
| R-5     | `ENGINEDUP putCalls= 3 objects= 3` — three objects for one lost response                             |
| R-6     | `expected null to be truthy` — no idempotency key on any attempt                                     |
| R-7     | `expected [ { id: 'detach-ops-1' } ] to have a length of +0 but got 1` — a no-op reported as applied |
| R-8     | `expected [ 'stat:9001', 'download:9001' ] to include 'hashObject:9001'` — full buffering            |

Every regression test was then run against the previous source and confirmed to
fail, then against the fix and confirmed to pass.

## PostgreSQL checks

A disposable `postgres:16-alpine` container was used for each check. The user's
own database was never touched.

| Check                                                              | Result                                                                 |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `prisma migrate deploy` on a fresh database                        | All migrations applied                                                 |
| R-1 atomic commit: a failed version insert rolls back the file row | `before=0 after=0`, then a valid commit succeeds with `versionCount=1` |
| R-3 claim: two concurrent `UNKNOWN` to `COMMITTING` claims         | `winners=1`                                                            |
| Migrations job tests with `OMNICLOUD_TEST_DATABASE_URL` set        | 8 files, 13 tests passed                                               |
| Same tests without the variable                                    | 8 skipped, and the new CI guard exits 1                                |

## CI

The `verify` job runs format, lint, typecheck, test and build. The `migrations`
job applies every migration on the runner's PostgreSQL, verifies the schema
matches the migrations, runs the PostgreSQL integration tests, and now fails if
any of them is skipped.

## Live Telegram

No live Telegram verification was run in this remediation. The only live check on
record is the caption search performed at 0.2.29, recorded in
`docs/phase-0-report.md`.

## Not covered

- Memory measurement under a representative large-file workload. The streaming
  paths were checked by observing which methods are called (`hashObject` instead
  of `download`), not by measuring peak memory.
- Restart recovery across a real process restart. The crash cases were simulated
  by injecting failures at the relevant points.

## Phase 9 verification sweep (branch `post-audit-remediation`, HEAD `3b4177f`)

Run on a disposable `postgres:16-alpine` container. The user's own database was
not touched.

| Check                                      | Command                                         | Result                                       |
| ------------------------------------------ | ----------------------------------------------- | -------------------------------------------- |
| Migrations apply on a fresh database       | `prisma migrate deploy`                         | All applied, including migration 7           |
| Schema matches the migrations              | `prisma migrate diff --exit-code`               | Exit 0                                       |
| PostgreSQL integration suite               | `vitest run` with `OMNICLOUD_TEST_DATABASE_URL` | 8 files, 13 tests passed                     |
| New FK indexes exist and are used          | `pg_indexes` and `EXPLAIN`                      | Both present; both queries use an index scan |
| Parent/child folder query                  | repository round trip                           | Passes                                       |
| SDK built package, ESM import              | `node --input-type=module`                      | OK                                           |
| SDK built package, CJS import              | `node -e require`                               | OK                                           |
| Packed tarball installs in a clean project | `npm pack` + `npm install <tgz>`                | ESM and CJS imports OK                       |

Workspace suites on the same commit: shared 14, core 271 (1 skipped), database 5
with 8 skipped without a database URL, telegram 35 (1 skipped), sdk 66, api 131.
Format, lint, typecheck and build all pass.

Still not covered: live Telegram behaviour. The release gate remains unsatisfied.

## Web bundle size (plan item 3.4)

Measured on the production build (`pnpm --filter @omnicloud/web build`, Vite),
Node v24.21.0, Linux. The plan's target was a main chunk under 350 KB on a
gzip basis; that target is **met**.

| Chunk                    | Raw    | Gzip       |
| ------------------------ | ------ | ---------- |
| `index` (main entry)     | 440 KB | **142 KB** |
| `LandingPage` (lazy)     | 37 KB  | 11 KB      |
| `ViewToggle` (lazy)      | 32 KB  | 10 KB      |
| `TelegramQrLogin` (lazy) | 27 KB  | 10 KB      |
| `TokensPage` (lazy)      | 14 KB  | 4 KB       |
| `StoragePage` (lazy)     | 9 KB   | 3 KB       |
| `DrivePage` (lazy)       | 9 KB   | 3 KB       |
| `LoginPage` (lazy)       | 11 KB  | 3 KB       |
| `DetailsPanel` (lazy)    | 5 KB   | 2 KB       |
| `TrashPage` (lazy)       | 3 KB   | 1 KB       |

21 JS chunks in total; ~192 KB gzipped for the whole set.

Route-level code splitting is in place: the landing page, drive, login, tokens,
storage, trash and recent views each load as their own chunk, so a visitor
landing on the marketing page does not download the application shell's feature
code.

**Before/after:** no bundle-size regression was introduced by the M5 streaming
work. The main chunk measured 450.65 KB / 146.12 KB gz before it and
450.73 KB / 146.16 KB gz after — a 0.08 KB difference, from the streaming
imports in `apps/web/src/api`. The 3.4 target did not require optimization work.

Reproduce with:

```bash
pnpm --filter @omnicloud/web build
for f in apps/web/dist/assets/*.js; do
  printf '%s KB gz | %s\n' "$(( $(gzip -c "$f" | wc -c) / 1024 ))" "$(basename "$f")"
done | sort -rn
```
