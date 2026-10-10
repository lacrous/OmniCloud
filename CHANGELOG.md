# Changelog

All notable changes to OmniCloud are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.26] — 2026-10-10

**Objects from an unknown upload are visible to reconciliation, not reported as orphans.**

### Fixed

- An upload recorded as `UNKNOWN` (0.2.25) could still have stored its Telegram object. The
  reconciliation scan protected only `UPLOADING` and `PENDING` objects, so an `UNKNOWN` one was
  reported as an orphan, and an operator could be led to treat it as stray data. It is now
  protected the same way as in-flight objects. Reconciliation still never deletes anything.

### Verified

- A test shows the `UNKNOWN` object is reported as an orphan without the fix and is not
  reported with it. Removing `UNKNOWN` from the protected list makes that test fail.
- Core is at 242 passing; the full workspace gate passes.

### Not decided

- How an `UNKNOWN` upload is resolved. This release does not resolve one; it only stops the
  scan from mislabelling it. That choice is still open.

## [0.2.25] — 2026-10-10

**A lost Telegram response is recorded as "outcome unknown", not "failed".** This is the part
of the ambiguous-write problem that does not depend on the policy choice. How an unknown
upload is resolved is still to be decided.

### Changed

- When an upload fails with a Telegram connection error, the write may already have stored the
  object. The operation is now marked `UNKNOWN`, not `FAILED`. Other failures, known to happen
  before the write, are still `FAILED` and can be retried.
- `UNKNOWN` is never claimed by a new request. An unknown upload is not silently re-uploaded,
  so a lost response cannot create a second Telegram message through a retry.

### Not decided yet

- How an `UNKNOWN` upload is resolved: searching the channel for the object, a user-initiated
  retry under a new key after checking, or accepting a possible duplicate. Until that is chosen,
  an `UNKNOWN` operation stays as it is and needs manual handling.

### Verified

- A test fails before the change (the lost response was recorded as `FAILED`) and passes after.
- Ordinary failures remain `FAILED` and retryable.
- Making `UNKNOWN` claimable makes the no-re-upload test fail, so the rule is tested.
- The `UNKNOWN` status stores and reads back on PostgreSQL, and new claims are refused; 13
  database tests pass.

### Not verified

- A live Telegram connection dropped after a successful write. The test uses the storage double.

## [0.2.24] — 2026-10-10

**Restoring a folder is all-or-nothing.** The last Phase 0 code item.

### Fixed

- Restoring a folder made three separate writes: the folders, the reparent, then the files. A
  failure between them left folders restored while their files stayed in the Trash. The
  restore is now one atomic write, the same pattern used for trash in 0.2.23.

### Verified

- A test fails on the previous three-write restore and passes now.
- The atomic write runs against a real PostgreSQL transaction, including the reparent.
- The database suite passes 12 of 12 on five fresh PostgreSQL databases.
- The core suite is at 238 passing; the API at 120; the workspace builds and the declarations
  check passes.

### Not verified

- Live Telegram behaviour; this change is storage-metadata only.

## [0.2.23] — 2026-10-10

**Completes the Phase 0 items that do not depend on the ambiguous-write policy.** Telegram
error classification, folder trash atomicity, and historical versions on folder delete.

### Fixed

- **Permanent Telegram errors are no longer retried.** `CHAT_WRITE_FORBIDDEN` and
  `CHAT_ADMIN_REQUIRED` now map to a permission error; `PEER_ID_INVALID` (a stale channel
  reference) maps to a storage-not-initialised error. Both are non-retryable. They were
  previously reported as retryable connection failures.
- **Trashing a folder is all-or-nothing.** The folder subtree and its files were stamped in
  two separate writes, so a failure between them left folders trashed while their files stayed
  active. A new repository method stamps both in one database transaction.
- **Permanently deleting a folder removes every Telegram object it created.** It removed only
  each file's current message, so historical versions were orphaned: their rows were dropped
  while their Telegram messages stayed. It now removes every version's message first, as the
  single-file delete already did.

### Verified

- Each fix has a test that fails on the previous code. The atomicity test fails on the old
  two-write path.
- The atomic trash write runs against a real PostgreSQL transaction; all 11 database tests pass
  on that instance.
- The core suite is at 237 passing; the API at 120; the Telegram package at 27.

### Not verified

- Live Telegram behaviour of the permanent-error mapping and of deleting versions on a real
  channel.

## [0.2.22] — 2026-10-10

**Telegram flood waits keep the server's delay, and deleting a missing message succeeds.**
Phase 0 Telegram-provider audit fixes.

### Fixed

- A Telegram flood wait lost its retry delay. GramJS reports the message as `FLOOD` and sets
  the delay in `seconds`, but the mapping looked for a `FLOOD_WAIT_` prefix that never
  matched, so a 30-second instruction became a generic connection error with no delay. It now
  reads the delay the server sent, and maps it to a rate-limit error with that delay.
- Deleting a Telegram message that was already gone failed, although the storage contract says
  a missing object must not throw. That made cleanup retries fail. A missing message is now
  treated as already deleted. Any other failure, such as a network error, is still reported.

### Verified

- Both fixes were reproduced first, with the library's own error mapping. Without the fixes
  three of the four new tests fail; with them all pass.
- The Telegram package suite is at 25 passing. The live Telegram test is still skipped, since
  it needs real credentials.

### Not verified

- Behaviour against a live Telegram account, including how often real flood waits occur.

## [0.2.21] — 2026-10-10

**The web app's upload retries cannot create duplicate files.** Phase 0 frontend and
documentation audit fixes.

### Fixed

- Retrying a failed upload in the web app sent a new request with no idempotency key. If the
  first attempt had stored the file but its response was lost, the retry created a second
  file. Each upload job now has one key, created when the job is queued and sent with every
  attempt, including retries. Replacements carry the same key.
- `docs/api.md` did not document the QR sign-in routes or the version-prune route. It now
  does, with the response shapes the server returns.

### Verified

- A browser-shaped retry returns the original file. Without the key the same retry creates a
  second file; that case is covered too, so removing the key would fail the suite.
- The web app typechecks, lints and builds. The API suite is at 120 tests.

### Checked and found correct

- Permanent delete and empty-trash both ask for confirmation before calling the API.
- The documented environment variables and CLI commands match the code.

### Not verified

- The browser upload end to end in a real browser against a live Telegram account.

## [0.2.20] — 2026-10-10

**CI runs the real-PostgreSQL tests, and releases verify the packed package.** Phase 0 CI/CD
audit fixes. No code change for users.

### Changed

- The migrations job in CI now runs the PostgreSQL integration tests. They were silently
  skipped on every pull request, because `OMNICLOUD_TEST_DATABASE_URL` was set nowhere in
  CI. That included the race and version-number tests added in 0.2.14 and 0.2.15, which
  were proven only on a developer machine.
- The release workflow packs the SDK, installs the tarball into a clean project, and checks
  the `omnicloud` command and both module formats **before** publishing. The previous
  release check imported the build directory, not the package a consumer receives.
- The release workflow no longer requests the `id-token` permission, which the publish did
  not use.
- Corrected a damaged comment in the CI migrations job.

### Verified

- On a fresh PostgreSQL: migrations apply, the schema diff is empty, and all ten database
  tests pass, including the five that CI previously skipped.
- The exact clean-install step from the release workflow passes when run locally.

### Not verified

- The workflows themselves on GitHub. They run on the next PR and release.

## [0.2.19] — 2026-10-10

**SDK: silent empty writes fixed, and automatic retries no longer repeat writes.** Phase 0
API/SDK audit fixes.

### Fixed

- `files.replace()` sent an empty body when given a `path`, a stream, or a byte array,
  and reported success. It now accepts the same inputs as `upload()`.
- A stream upload that failed once and was retried was sent again as an empty body, and
  the retry reported success. The SDK now converts the input once and sends the same bytes
  on every attempt.
- `folders.list({ parentId })` dropped `page`, `limit` and the sort fields, so page 2 was
  answered with page 1. Paging is kept, and the root listing still sends `parentId=`.

### Changed (behaviour change for SDK users)

- The SDK no longer retries `POST` and `PATCH` automatically on 408, 429 or 5xx. The server
  may already have applied a write before the failure, so repeating it can apply it twice.
  `GET`, `HEAD`, `PUT`, `DELETE` and `OPTIONS` are still retried. Callers who want a retry
  for a write must retry themselves, and should use an idempotency key where the endpoint
  supports one.

### Verified

- Each fix has a test that fails on the previous code and passes now. The SDK suite is at
  54 tests; the workspace suites, build and declarations pass.

### Not fixed in this release

- Upload and replace retries still have no SDK-side idempotency option, so they are repeated
  without a key. Callers that need exactly-once uploads should pass `operationId`.
- Ambiguous Telegram writes on the server.

## [0.2.18] — 2026-10-10

**Replacing a file can be retried safely.** Phase 1 item: replacement idempotency.

### Fixed

- `POST /api/files/:id/replace` ignored the `Idempotency-Key` header and the `operationId`
  field, so a retried replacement created a second version. It now uses the same keyed
  path as uploads: a retry with the same key creates one version.
- A replacement key reused with different bytes was accepted. It is now refused with
  `409 CONFLICT`, and the fingerprint includes the target file, so a key spent on one file
  cannot be replayed on another.

### Unchanged

- Replacements without a key still create one new version per request, as before.

### Verified

- Route tests fail on the previous code (a retry created a second version; a reused key was
  accepted) and pass now, with the keyless path and the cross-file case covered.

### Not fixed in this release

- Ambiguous Telegram writes after a lost response.

## [0.2.17] — 2026-10-10

**An upload key cannot be reused for a different file.** Phase 1 item: request fingerprints.

### Changed

- Each upload operation now stores a fingerprint of its request: the sanitized name, the
  target folder, the file being replaced, and the content hash. A later request under the
  same key must present the same fingerprint.
- A reused key with different content, a different name, or a different folder is refused
  with `409 CONFLICT` and the message "This upload key was already used for a different
  file". Nothing is stored or changed.
- An identical retry still returns the original file.

### Database

- Migration `5_upload_request_fingerprint` adds a nullable `requestFingerprint` column to
  `UploadOperation`. Existing rows keep null and their previous behaviour.

### Verified

- Before the change, a reused key with different content silently returned the old file;
  the tests fail on that behaviour and pass now.
- API route tests: an identical retry returns the original file; a reused key with different
  bytes returns 409 and nothing new is stored.
- The migration applies to a clean PostgreSQL, and the fingerprint round-trips through the
  database.

### Not fixed in this release

- Ambiguous Telegram writes after a lost response.
- Replacement operations do not yet carry a fingerprint.

## [0.2.16] — 2026-10-10

**Release hardening: the publish step builds the CLI.** No change for users.

### Changed

- `prepublishOnly` now also builds the `omnicloud` command and the server bundle, not only
  the SDK declarations. Previously `npm publish` read the `bin` entry before the CLI was
  built, so a clean release runner could publish without it.

### Verified

- Removing the built CLI and running a publish dry run now reproduces the warning; with the
  change, the build step runs before npm reads the manifest.
- 0.2.15 was checked after publish: its metadata lists `"omnicloud": "./dist/cli.js"`, and a
  clean install runs `omnicloud version`. The bin was not missing from that release.

### Not verified

- The next release on a clean GitHub runner. This changes the publish path, so the release
  workflow will confirm it.

## [0.2.15] — 2026-10-10

**Replacing a file after pruning no longer fails.** Phase 1 item: version numbering.

### Fixed

- A new version was numbered `count + 1`. After a prune removed a middle version, the count
  could equal a number that still existed, and PostgreSQL rejected the insert with a
  duplicate-key error. Every later replacement of that file then failed. The next number is
  now one past the highest existing number, chosen inside a transaction.
- The in-memory test repository now uses the same numbering and enforces the same
  uniqueness, so this class of bug shows up in ordinary tests.

### Verified

- Reproduced on a real PostgreSQL database: versions 1 and 3 surviving a prune gave a
  duplicate-key error for number 3. The fixed code writes number 4.
- A PostgreSQL regression test fails on the old logic and passes on the fix.

### Not fixed in this release

- Ambiguous Telegram writes, request fingerprints, and replacement idempotency.

## [0.2.14] — 2026-10-10

**Uploads: one file record per upload, even when two requests race.** Phase 1 work, first
item: the commit race from the idempotency audit.

### Fixed

- Two requests with the same upload key, arriving while the first is committing a stored
  object, could each write a file record. Now the commit takes an exclusive claim
  (`UPLOADING → COMMITTING`), so only one request writes the record. The other follows the
  result.
- The upload state machine now includes `COMMITTING`, and completion must pass through it.
  Previously the transition table allowed a direct `UPLOADING → COMPLETED` that the code
  did not enforce.

### Verified

- A regression test holds the first request inside its commit and sends a second request
  with the same key. Without the fix it creates two records; with it, one. The test fails
  without the fix and passes with it.
- A retry after success returns the original file and creates no second object or record.

### Not fixed in this release

- Ambiguous Telegram writes (a lost response can still store a second message).
- The request fingerprint: a retry with different content under the same key is still
  accepted silently.
- Version numbers after pruning can collide (`count + 1`).
- Replacement operations do not yet take the same idempotency protection.

### Not verified

- The race against a real PostgreSQL database. The claim relies on a conditional update,
  which the database implements atomically, but the test uses the in-memory repositories.

## [0.2.13] — 2026-10-10

**Filenames: invisible direction and zero-width characters are removed.** Phase 0
security audit fix.

### Fixed

- A file name containing a right-to-left override (for example U+202E) could display with a
  false extension, such as `report` followed by `exe` reversed to look like `.pdf`. The
  override, bidi isolate and zero-width characters, and C1 control characters are now
  removed when a name is sanitized.

### Verified

- Four new tests fail on the previous code and pass now. Ordinary non-Latin names are kept
  unchanged. The existing traversal and control-character tests still pass.

### Not verified

- How individual browsers and file managers render names after this change, and live
  Telegram behaviour.

## [0.2.12] — 2026-10-10

**Folder deletes respect the parent foreign key.** Phase 0 audit fix.

### Fixed

- Deleting a folder subtree, or emptying Trash, removed a parent folder before its
  children. PostgreSQL refuses that (`ON DELETE RESTRICT`), so the request failed after
  the files were already removed, and every retry repeated the failure. Folders are now
  deleted deepest-first in both paths.
- Empty Trash used to order folders shallowest-first, the opposite of what the foreign
  key needs.

### Test changes

- The in-memory folder repository now enforces the same restriction as PostgreSQL. Three
  existing tests had been passing only because the fake allowed a parent to go before its
  children, so they now test the real rule.
- Ordering tests cover a three-level chain, sibling branches, and a corrupted cycle.

### Verified

- Against a disposable PostgreSQL: deleting a parent with a child is rejected, and
  deleting the child first succeeds.

### Not verified

- Live Telegram, and the full folder-delete path against PostgreSQL in CI.

### Found, not fixed in this release

- Folder restore and folder trash are multiple writes without a transaction (DB-5).
- Historical Telegram versions are not removed when a folder is deleted or Trash is emptied
  (DB-3).
- Telegram flood-wait values are lost because GramJS reports the message as `FLOOD`, not
  `FLOOD_WAIT_n` (Telegram F1).
- Some Telegram errors are retried as connection failures (Telegram F4).
- Upload idempotency gaps around concurrent commits and version numbers after pruning
  (idempotency F1–F6).

## [0.2.11] — 2026-10-09

**Reconciliation reports only what it changed.** Phase 0 audit fix.

### Fixed

- Applying a "detach" repair for a message that no file of yours references used to be
  reported as `applied` even though nothing changed. It is now reported under `failed`
  with the reason: there is nothing to detach. A regression test pins this.

### Found, not changed in this release

- The SDK's upload path (`packages/sdk/src/client.ts`, `toBlob`) collects a stream or a
  file path into one in-memory Blob before sending. Its comment says streams are never
  buffered, which is wrong. Streaming the body would change retry behavior for one-shot
  streams, so it is a deliberate change for its own release.

### Not verified

- Live Telegram. The reconciliation fix is tested against the in-memory repositories.

## [0.2.10] — 2026-10-09

**Version retention, as an explicit action.** Historical versions can now be pruned under a
policy you name. Nothing is pruned automatically.

### Added

- `POST /api/files/:id/versions/prune` with a body of `{"policy":"KEEP_ALL"}`,
  `{"policy":"KEEP_LATEST_N","count":N}` or `{"policy":"KEEP_FOR_DAYS","days":D}`.
  Anything else is rejected with `400`, so a typo cannot widen a prune.
- `FileService.pruneVersions` removes each doomed version in the same order as a
  permanent delete: the Telegram message first, then the version row. A failed remote
  delete keeps that version. The current version is never removed.
- `FileVersionRepository.deleteVersion(versionId)` in the Prisma repo and both fakes.

### Changed

- `docs/limitations.md` now describes retention as an operator action rather than
  "defined but not enforced".

### Verification

- Core: 5 tests for pruning, including the failure path and the current-version rule.
  A deliberate reordering of the delete steps makes the failure test fail, so the
  order is enforced by a test.
- API: 7 route tests covering authentication, each policy, rejected inputs, and a
  second user's file being untouched.
- PostgreSQL: `deleteVersion` checked against a disposable database, removing only the
  named version.

### Not included

- A scheduled, automatic scan or prune. Listing which accounts a background job may read
  needs a decision about scope, so it is not built.

### Not verified

- Pruning a real file against live Telegram storage. The Telegram delete is exercised
  through the storage double.

## [0.2.9] — 2026-10-09

**Verification.** New tests and measurements for the hardening plan's stress, restart,
and platform items. No behavior changes for users.

### Added

- **Browser opener on Windows.** `omnicloud` opens the browser with
  `rundll32 url.dll,FileProtocolHandler` on Windows, not `cmd /c start`, so the URL is
  never parsed by the command shell. The choice per platform is covered by tests.
- **Kill-and-restart test.** A real child process is spooling an upload when it is killed
  with SIGKILL. The sweep then removes its orphaned spool. The spool module is bundled
  to plain JavaScript for the child, so no TypeScript loader is needed.
- **Volume test (opt-in).** `OMNICLOUD_VOLUME_FILES=5000 pnpm --filter @omnicloud/core test
stress-volume` uploads thousands of files across hundreds of folders and checks counts.

### Measured

- Upload memory over a real socket, sender in a separate process: 10 MB +4.5 MB,
  50 MB +0.7 MB, 100 MB +7.5 MB. Memory does not grow with file size.
- Volume: 5,000 files across 200 folders in 4.3 s, all counts consistent. This uses
  in-memory repositories, so it measures the service logic, not PostgreSQL or Telegram
  latency.

### Fixed in the measurement tool

- `measure:upload-memory` sampled memory every 10 ms, forcing a garbage collection each
  time and stalling the transfer. It now samples every 250 ms (configurable with
  `UPLOAD_MEMORY_SAMPLE_MS`). Earlier 10 MB and 50 MB results remain valid.

### Not verified

- The Windows and macOS openers are checked as commands, not by launching a browser.
- Live Telegram, 100 MB uploads against real Telegram, and PostgreSQL under volume.

## [0.2.8] — 2026-10-09

**Connect with the Telegram app.** The login page shows a QR code. Scan it in
Telegram (Settings → Devices → Link Desktop Device) to sign in without typing a code.

### Added

- `POST /api/auth/telegram/qr/start`, `GET /api/auth/telegram/qr/status?flowId=…` and
  `POST /api/auth/telegram/qr/password` for QR sign-in. The browser session cookie is
  issued only after Telegram confirms the approval, as with the phone-code login.
- The login page shows the QR code first, with the phone-number form below it as a
  fallback. Two-factor accounts are asked for their cloud password after approval.
- `qrcode` (MIT) renders the `tg://login` link as an image in the browser.

### Changed

- The phone-code login path is unchanged. Its session handling moved into a shared
  helper, `finalizeConnectedClient`, which both logins use.

### Verification

- 6 route tests cover the QR states: waiting with a token, approval issuing the session
  cookie, the password step, an unknown flow, and a missing flow id.
- All 105 API tests, the Telegram package, and the web build pass.
- The login page renders the QR panel and the phone fallback in headless Chromium.
- The QR image is generated from a `tg://` link.

### Not verified

- **The real Telegram QR exchange.** The routes were tested against a double of the
  Telegram connection, not the live service. The approval step needs a real account
  and a phone, and has not been run.
- **Two-factor sign-in through QR** against a real account.

## [0.2.7] — 2026-10-09

**Guided first run.** On its first run, `omnicloud` asks for the database URL and Telegram
credentials in the terminal and writes `.env` for you.

### Added

- When `.env` is missing and the command runs in a terminal, `omnicloud` prompts for
  `DATABASE_URL`, `TELEGRAM_API_ID` and `TELEGRAM_API_HASH`, validates them, and asks
  before saving.
- The encryption key (`OMNICLOUD_ENCRYPTION_KEY`) is generated automatically with 32
  random bytes.
- The saved `.env` is created with mode `0600`.

### Unchanged

- Non-interactive starts (systemd, CI, pipes) with no `.env` still fail with the same
  message and never prompt or write a file.
- An existing `.env` or a `DATABASE_URL` in the environment skips the questions.

### Verification

- In a pseudo-terminal, the prompts saved `.env` with mode `0600`, migrated the database
  and started the server.
- Declining the save and entering an invalid `DATABASE_URL` both write no file.
- The non-interactive start exits 1 with the existing message.

### Not included

- Signing in to Telegram from the web page with a QR code or a "Connect" button that
  opens the Telegram app. The sign-in still uses the phone number and confirmation code.

## [0.2.6] — 2026-10-09

**One command.** `npx omnicloud` now applies the database schema, starts the server and
opens the web app in your browser.

### Changed

- Bare `omnicloud` (no arguments) runs `start`.
- `start` applies pending migrations before the server starts. Migrations already
  applied are skipped, so the step is safe on every start. `--migrate` is still accepted
  and does nothing extra.
- `start` opens the web app once `/api/health` answers. The browser URL uses `127.0.0.1`
  when `HOST` is `0.0.0.0`. Ctrl+C stops the server and the CLI together.
- `start --no-open` skips the browser. The systemd example in `docs/deployment.md` uses it.
- README, deployment and troubleshooting docs describe the single command.

### Verification

- Bare `omnicloud` against PostgreSQL: migrations checked, server started, health
  answered, browser opener called with `http://127.0.0.1:4320`.
- Ctrl+C stopped the server and released the port.
- `--no-open` started the server and did not call the opener.
- A missing `DATABASE_URL` exits 1 with a message.

### Not verified

- The browser opener on macOS and Windows. Only the Linux `xdg-open` path was exercised,
  with a stub on `PATH`.

## [0.2.5] — 2026-10-09

**Documentation: a dependency advisory that needs an operator override.** No code changes.

### Security

- `npm audit` still reports three high-severity findings after 0.2.4: `prisma`,
  `@prisma/config` and `deepmerge-ts` (GHSA-ggr8-5vv4-36mx). Prisma 6.19.x pins
  `deepmerge-ts` 7.x, and npm ignores the `overrides` field of a published package.
- Operators can clear the findings with an `overrides` entry in their own project:
  `"overrides": { "deepmerge-ts": "^8.0.2" }`. The exposure is in Prisma's
  configuration loader, not in request handling.
- Documented in `README.md` (Security) and `docs/security.md` (Open advisory).

### Verification

- From a clean consumer project with the override, `npm audit` reports zero findings
  and `npx omnicloud migrate` exits 0 against PostgreSQL.

## [0.2.4] — 2026-10-09

**Security: dependency fixes.** Clears the known vulnerabilities reported by
`npm audit` for `@lacrous/omnicloud@0.2.3`. No API or data changes.

### Security

- `@fastify/static` 8 → 10 (fixes four high-severity path-traversal and route-guard
  advisories). Static serving of the web app is unchanged.
- `deepmerge-ts` pinned to 8.x through a `pnpm-workspace.yaml` override (fixes a
  high-severity stack-exhaustion advisory reached through `@prisma/config`).
- `react-router-dom` 6 → 7 in the web app (fixes two moderate advisories). The web app
  uses only the declarative routing API, which is unchanged in v7.

### Verification

- API tests (99) and the web build, lint and typecheck pass.
- The bundled server serves the web app, deep links and the API.
- Prisma `generate`, `validate` and `migrate status` pass with the new `deepmerge-ts`.
- The signed-in pages (Drive, Recent, Starred, Trash, Storage) were not exercised
  against a live Telegram account.

## [0.2.3] — 2026-10-09

**Run OmniCloud from npm.** `npm install @lacrous/omnicloud` now installs the full
server, the built web app and an `omnicloud` command. The SDK API is unchanged.

### Added

- `omnicloud` command with `start`, `migrate`, `version` and `help`. `start --migrate`
  applies migrations first. The command reads `.env` in the current directory without
  overriding variables already set in the environment.
- The package ships the bundled server (`server/`), the web UI, and the Prisma schema
  and migrations.
- `packages/sdk/scripts/bundle-server.mjs` builds the server bundle. `prepack` runs
  the SDK build, the CLI build and the bundle, so `npm pack` always produces a complete
  package.
- A new `README.md` covering the npm quick start, configuration, the command reference,
  Telegram setup, backups and limitations.

### Changed

- `omnicloud start` regenerates the Prisma client for the installed version before it
  starts, so a fresh install needs no extra step.
- `omnicloud start` exits with code 1 and a message when the server fails, instead of
  exiting silently.
- Documentation: `docs/deployment.md` has an npm install section and a systemd unit;
  `docs/troubleshooting.md` covers npm errors and lists migrations 0–4.
- Lint ignores the generated `packages/sdk/server/` bundle and applies Node globals to
  `.mjs` files.

### Database

- Migrations `3_browser_sessions` and `4_upload_operations` are unchanged from 0.2.2.
  Existing databases need `omnicloud migrate` (or `pnpm db:migrate`) once.

### Not verified

- The Telegram path is still unverified against a live account; see the 0.2.2 notes.

## [0.2.2] — 2026-10-09

**Hardening: streaming, recovery, security and the SDK.** Uploads and downloads no longer
buffer whole files, failed operations leave no orphaned Telegram objects, and the SDK
gains streaming APIs.

> **Breaking changes.** (1) Existing users sign in once after upgrading: old JWT
> cookies are rejected. (2) `X-Integrity-Verified` is removed from the download
> endpoint; treat an incomplete transfer as failed. (3) `OMNICLOUD_ENCRYPTION_KEY`
> is required in production. (4) The Telegram path is verified only against fake
> clients; live verification is still required before relying on it.

### Reliability

- **Retries decide from the error type, not its message.** Errors declare whether
  they are retryable (`DomainError.retryable`). Message matching is removed.
- **Flood waits are honoured exactly.** `RateLimitedError` carries the
  server-requested `retryAfterSeconds`, and the engine waits that long.
- **Uploads are idempotent.** An `Idempotency-Key` header (or `operationId` field)
  makes a retried upload return the original file. A retry never creates a second
  Telegram object. An operation whose object was stored but whose metadata failed
  is recovered without uploading again. Keys are per user and must be 8–64 URL-safe
  characters.
- Migration `4_upload_operations` is additive.

### Fixed

- **Restore cannot attach a folder under another user's folder.** A foreign
  parent id in a trashed folder's row is now dropped on restore, and the folder
  falls back to the root.
- **The served web app now sends a Content-Security-Policy.** The policy allows
  inline scripts and styles only by hash, so an injected inline script is blocked.
  Previously the page had no policy, although a code comment said it did.

- **Concurrent uploads with the same idempotency key store one object.** Requests
  that raced to create the operation used to fail with a duplicate-key error,
  because the create had no typed handling. A losing request now follows the
  winner's result. Only the request that wins an atomic claim from `PENDING` (or
  `FAILED`) uploads. Found by a concurrency test; the claim is verified with a
  pause placed before it, which fails when the claim is removed.
- **A recursion bug in the new follow-the-winner path** could run out of memory
  under contention. Replaced with a bounded loop; a request that cannot finish
  within the budget gets a conflict, not an unbounded wait.

- **Concurrent folder moves cannot create a cycle.** Two moves that each passed the
  ancestor check could both commit, making A and B each other's parent. Moves now
  re-check the ancestor chain and write in one serializable transaction, so one
  of two conflicting moves is rejected. Reproduced on PostgreSQL before the fix
  (5 of 5 runs created a cycle) and verified after (0 of 5). A PostgreSQL
  regression test runs when `OMNICLOUD_TEST_DATABASE_URL` is set.

- The SDK rejects a download whose body ends before `Content-Length` with
  `DOWNLOAD_INCOMPLETE`, instead of returning a truncated buffer.

### Added

- **SDK streaming APIs.** `files.downloadStream()` returns the body as a stream,
  and `files.downloadToFile()` (Node) writes it to disk through a `.part` file that
  is renamed only after the length is verified, so a failed download leaves nothing
  at the target. `files.upload()` now also accepts a web `ReadableStream`, a Node
  `Readable`, or a file path, in addition to a Blob or `Uint8Array`.
- **Reconciliation repair, as two explicit steps.** `POST /api/storage/reconciliation/plan`
  returns the actions that could be approved and changes nothing. `.../apply` takes
  the approved ids, reruns the scan, and applies only ids the fresh plan still
  offers. Neither step deletes a channel message: a dangling record is marked, and
  an unknown object is adopted with its real SHA-256.

- `docs/limitations.md` is now the single list of what this release does not
  guarantee. Earlier pages that said uploads were buffered in memory, or that
  sessions were signed JWTs, were corrected to match the code.
- `docs/release-checklist.md` names the command or test behind each release item.

- Health probes: `GET /api/health/live` (process liveness, checks no dependency)
  and `GET /api/health/ready` (database and encryption configuration; `503` when
  not ready). Storage is not part of readiness.
- One structured record per upload, permanent delete, and streamed download
  (duration, size, status, error code). Records contain no file contents.
- Log redaction masks session strings, cookies, tokens, passwords, login codes
  and the configured secrets before any line is written.

- `POST /api/storage/reconciliation` — a **read-only** report of channel objects no
  record references (`unknown`) and records whose object is gone (`dangling`).
  It never deletes anything. Unknown objects are reported for a person to decide.

- **A failed commit no longer leaves an unreferenced Telegram object.** If the file
  or version record cannot be written after Telegram accepted the upload, the
  stored object is removed and the original error is returned. This covers a new
  upload, and a replace whose file was deleted mid-upload. Regression tests fail
  without the cleanup.
- Batch file operations accept an optional `operationId`, echoed in the result, so
  a batch can be correlated with its outcome.

- **Permanent delete no longer orphans old versions.** Historical version objects
  were removed best-effort, and their metadata was then deleted even when the
  Telegram delete failed. Any remote failure now fails the operation and keeps
  every version pointer, so a retry completes the cleanup.

### Changed

- **Integrity checks cover historical versions.** `POST /api/storage/integrity/check`
  inspects each version object as well as the current one. Issues on a version
  carry a `versionId`.
- **Deep integrity streams.** The deep check hashes each object while streaming
  it, instead of downloading it into memory.
- A version retention model (`KEEP_ALL`, `KEEP_LATEST_N`, `KEEP_FOR_DAYS`) is
  defined and tested. It is not yet enforced: the default keeps every version, and
  the current version is never a candidate for pruning.

- **File downloads stream from Telegram.** `GET /api/files/:id/download` pipes
  Telegram chunks straight to the client instead of buffering the whole file.
  Verified with unit tests against a fake GramJS client; not yet measured against
  a live account.
- **Uploads are spooled to disk.** `POST /api/files` and `POST /api/files/:id/replace`
  write the multipart body to a temporary file while hashing it, then hand that
  file to GramJS by path. The temporary file is removed on success and failure.
  The engine no longer concatenates the whole upload in memory. Measured with
  `pnpm --filter @omnicloud/api measure:upload-memory`: an 8x larger upload adds
  about the same live memory (0.4 MB vs 0.5 MB).
- **Integrity is verified before the final bytes are released.** A corrupt object
  ends the response with a broken connection rather than a complete-looking body.
- **`X-Integrity-Verified` header removed from the download endpoint.** It cannot
  be known before a streamed body is sent. Clients should treat an incomplete
  transfer as a failed download.

### Security

- **Browser sessions are server-side and revocable.** The cookie is an opaque
  random token; only its SHA-256 is stored (`BrowserSession`). Logout revokes the
  session immediately, so a copied cookie stops working. `POST /api/auth/logout-all`
  signs out every session for the account. Expired sessions are pruned hourly.
  Migration `3_browser_sessions` is additive; existing users must sign in again
  once, because old JWT cookies are no longer accepted.
- **Telegram sessions are encrypted at rest** (AES-256-GCM), keyed by the new
  `OMNICLOUD_ENCRYPTION_KEY`, which is required in production. Existing plaintext
  sessions are re-sealed on first use.
- `SESSION_SECRET` no longer signs anything and is no longer required in production.

## [0.2.1] — 2026-10-08

### Fixed

- **SDK type declarations were incomplete.** The published `@lacrous/omnicloud@0.2.0`
  `index.d.ts` imported internal modules (`./query`, `./mime`, `./client`, `./errors`)
  that are not shipped in the package, so TypeScript consumers got missing or `any`
  types. The bundled declarations are now self-contained, and the build no longer
  prints "Ambiguous external namespace resolution" warnings.
- Recent view orders activity by `(createdAt, id)`, so events recorded in the same
  millisecond resolve deterministically.

## [0.2.0] — 2026-10-07

**Reliability & Storage Experience.** This release makes the v0.1 proof-of-concept
trustworthy for everyday use: a real file lifecycle, a resilient storage engine, a
dependable Telegram connection, integrity checking, and a full Drive UI.

### Added

- **Trash and restore.** Deletion is now a soft delete; a folder's whole subtree is
  trashed and restored as one set (tracked by a batch marker, not timestamps), and
  restore falls back to the root when the original parent is gone. Permanent deletion
  removes the remote Telegram objects first and keeps the metadata if that fails, so
  interrupted deletions can be retried instead of silently losing data.
- **File versioning foundation.** Every upload creates a `FileVersion` row; a new
  `POST /api/files/:id/replace` endpoint appends a version and repoints the file at
  it. The data model and API are in place; a version-history UI is planned for v0.3.
- **Starred and Recent.** Files and folders can be starred, with a `/api/starred`
  view, and `/api/recent` lists the files you actually touched, newest first,
  deduplicated and excluding trashed items.
- **Activity log.** Structured, ownable events for uploads, downloads, opens, renames,
  moves, stars, trashes, restores, deletions and folder creation, with
  credential-shaped metadata keys stripped before storage.
- **Search 2.0.** A small PostgreSQL-backed query language:
  `type:pdf`, `type:image`, `ext:zip`, `size:>100MB`, `size:<1KB`, `folder:Projects`,
  `starred:true`, `trashed:true`, `after:2026-01-01`, `before:2026-06-01`.
- **Storage dashboard.** `/api/storage/stats` returns file and folder counts, total
  and trash size, starred count, a per-category byte breakdown and the largest files.
- **Integrity checking.** `/api/storage/integrity/check` (optionally deep) reports
  missing objects, size mismatches, hash mismatches and unreadable objects. It is
  strictly read-only — repairs are never applied automatically.
- **Telegram connection manager.** Explicit connection states (`DISCONNECTED`,
  `CONNECTING`, `CONNECTED`, `RECONNECTING`, `ERROR`, `AUTH_REQUIRED`), cached health
  probes, cooldown-guarded reconnection, and a per-user storage `healthCheck` that
  validates the channel with a real round-trip.
- **Storage engine 2.0.** Streaming-friendly provider interface
  (`getStream`, streamed uploads), bounded retries with exponential backoff (only
  transient failures retry), transfer progress reporting, and cancellation via
  `AbortSignal`.
- **API 2.0.** Pagination (`page`/`limit` with a `{page,limit,total,hasMore}`
  envelope), sorting (`sort`/`order`), filtering (`type`, `ext`, `starred`, `status`,
  size and date bounds), batch operations for files and folders
  (`POST /api/files/batch`, `POST /api/folders/batch`), trash endpoints, and public
  health probes (`/api/health`, `/api/health/database`).
- **Request tracing and hardening.** Every request gets an id (inbound `X-Request-Id`
  honored and echoed, included in error bodies), baseline security headers are set,
  and state-changing requests are checked against an origin allowlist.
- **Structured error codes.** A stable vocabulary (`AUTH_REQUIRED`, `FILE_NOT_FOUND`,
  `STORAGE_UNAVAILABLE`, `TELEGRAM_AUTH_REQUIRED`, `UPLOAD_FAILED`,
  `INTEGRITY_CHECK_FAILED`, …) with consistent HTTP statuses.
- **Drive UI 2.0.** Sidebar navigation (My Drive, Recent, Starred, Trash, Storage),
  grid and list views with a persisted preference, sorting, multi-select with a batch
  action bar, right-click and per-item context menus, a details panel with version
  history, drag-and-drop uploads with progress, cancel and retry, keyboard shortcuts,
  and a Storage dashboard with the integrity scan.
- **SDK 0.2.** `OmniCloudClient` now exposes namespaced APIs
  (`cloud.files`, `cloud.folders`, `cloud.trash`, `cloud.storage`, `cloud.search`,
  `cloud.recent`, `cloud.activity`, `cloud.auth`), with configurable retry,
  upload/download progress, download integrity metadata, and structured
  `OmniCloudError` (status, code, requestId).
- **Developer experience.** `pnpm db:seed` seeds a local user with folders and files,
  `CONTRIBUTING.md` and `SECURITY.md` were added, and CI now also verifies that
  migrations apply cleanly to a fresh database and that the built SDK bundle imports
  in both ESM and CommonJS.

### Changed

- List endpoints default to active items only; trashed content appears solely in the
  Trash view (and via explicit `status=trashed|all`).
- `GET /api/auth/me` now also returns storage health, so the UI can show connection
  state without an extra request.
- Folder `DELETE` routes now perform the guarded permanent delete (remote objects
  first) instead of the v0.1 best-effort sweep.
- The web app was rebuilt on the shared design system with light/dark themes.

### Database

- Additive, backward-safe migrations: `starred`, `deletedAt`, `currentVersionId`,
  `versionCount` and `trashBatchId` columns; new `FileVersion` and `ActivityEvent`
  tables; and supporting indexes. Pre-v0.2 files are backfilled with version 1 so
  their history is complete.

### Fixed

- Files whose latest activity was a star or unstar no longer disappear from Recent.
- A folder move can no longer be directed into the folder's own descendant.

### Known limitations

- Files are buffered in memory during transfer; the default cap is `MAX_UPLOAD_MB`
  (256 MB). Telegram caps a single document at 2 GB.
- No end-to-end encryption — Telegram can technically read channel content.
- Version history is stored but has no dedicated restore UI yet.
- Single-process server; rate limiting is in-memory and applies to auth endpoints.
- Search is metadata-only (no content search).

## [0.1.1] — 2026-10-06

### Fixed

- The published ESM bundle used directory-style GramJS subpath imports
  (`telegram/sessions`, `telegram/client/uploads`), which Node's ESM loader
  cannot resolve — replaced with explicit file paths so
  `import { OmniCloudClient } from "@lacrous/omnicloud"` works in Node.
- Removed a duplicate `dts` key in the SDK build config.

## [0.1.0] — 2026-10-06

First public MVP. OmniCloud is a self-hosted cloud storage platform that uses
your own Telegram account as the underlying storage backend.

### Added

- Telegram account connection (phone → code → optional 2FA password) with
  server-side MTProto session management
- Automatic creation of a private Telegram storage channel per user
- File upload, download, rename, move, delete
- Folder creation, renaming, moving and recursive deletion
- Metadata-based search over file and folder names
- SHA-256 integrity verification of every uploaded file
- Drive-like web interface: navigation, search, drag-and-drop upload with
  progress, rename/move/delete dialogs
- StorageProvider abstraction with the first Telegram implementation
- PostgreSQL metadata layer via Prisma
- `@lacrous/omnicloud` SDK package (HTTP client + storage building blocks)
- Docker Compose development environment (PostgreSQL)
- GitHub Actions CI and release automation

### Known limitations

- Files are buffered in memory during upload/download; the default upload
  limit is 256 MB (configurable via `MAX_UPLOAD_MB`).
- End-to-end encryption is not implemented — Telegram can technically read
  channel content. See `docs/security.md`.
- No trash/recycle bin: deletion is permanent.
- No file sharing, public links, or multi-user collaboration.
- The web app and API must run as a single Node.js process (no clustering).
- Search is limited to name substring matching in PostgreSQL.
