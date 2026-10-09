# Release checklist

Run this before tagging a release. Each item names the command or test that
checks it, so a release manager can verify it rather than trust it.

## Code

- [ ] `pnpm lint` passes.
- [ ] `pnpm format:check` passes.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes. The PostgreSQL race test is skipped unless
      `OMNICLOUD_TEST_DATABASE_URL` points at a disposable database; run it there
      before a release that touches folder moves or uploads.
- [ ] `pnpm build` passes with no out-of-memory error. The SDK build sets its
      own heap size; see `deployment.md`.

## Behaviour that must not regress

- [ ] `pnpm --filter @omnicloud/api measure:upload-memory` reports memory growing
      about 1x or less for an 8x larger upload.
- [ ] `pnpm --filter @omnicloud/api measure:download-memory` stays under its
      ceiling (64 MB for a 128 MB file).
- [ ] The SDK declarations are self-contained (`packages/sdk` test
      `declarations.test.ts` passes).

## Database

- [ ] Every migration applies to an empty database.
- [ ] Every migration applies to a copy of the previous release's database.
- [ ] `prisma migrate diff` against the migrated database is empty, so the schema
      and the migrations agree.
- [ ] No migration drops or rewrites a table that holds user data in a single step.

## Security

- [ ] `OMNICLOUD_ENCRYPTION_KEY` is set in the production environment and is
      backed up apart from the database.
- [ ] The cross-user authorization suite (`authorization.test.ts`) passes.
- [ ] The session-leak test (`session-leak.test.ts`) passes.
- [ ] The served web app sends a Content-Security-Policy (`csp-served.test.ts`).
- [ ] No secret is committed. Check `git diff` for keys, tokens and session strings.

## Operations

- [ ] `GET /api/health/ready` returns `ready: true` in the target environment.
- [ ] `GET /api/health/live` returns `live`.
- [ ] A test upload and download succeed in the target environment, and an
      `upload.completed` record appears in the logs without file contents.
- [ ] Documentation matches the code: `README.md`, `docs/limitations.md`,
      `docs/deployment.md`, and `.env.example` agree on every environment variable.

## Live verification (required for any release that changes the Telegram path)

- [ ] Sign in with a real account, connect storage, upload, download, rename,
      move, trash, restore and permanently delete a file.
- [ ] Run a reconciliation on the account and confirm the `unknown` list is what
      you expect.
- [ ] Run `packages/telegram/test/live-provider.test.ts` with live credentials.

Until the live verification is done, the Telegram path is unverified against a
real account and the release notes must say so.

## Release

- [ ] Version numbers agree in every `package.json`.
- [ ] `CHANGELOG.md` has an entry for every user-visible change, with breaking
      changes stated.
- [ ] Tag, push, and confirm CI passes on the tagged commit.
