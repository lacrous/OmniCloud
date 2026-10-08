# Contributing to OmniCloud

Thanks for wanting to help. OmniCloud is a self-hosted cloud storage platform
that uses a Telegram account as the physical storage backend, with PostgreSQL
holding the logical filesystem. Contributions of all sizes are welcome.

## Getting set up

```bash
git clone https://github.com/Lacrous/OmniCloud.git
cd OmniCloud
pnpm install                 # installs deps, generates Prisma client, builds types
cp .env.example .env         # add TELEGRAM_API_ID / TELEGRAM_API_HASH and SESSION_SECRET
docker compose up -d         # PostgreSQL
pnpm db:migrate              # apply migrations
pnpm dev                     # API on :4000, web on :5173
```

Node.js 20+ (22 recommended), pnpm 10+, Docker (or your own PostgreSQL 14+),
and a free Telegram application from [my.telegram.org](https://my.telegram.org)
for anything that touches the storage backend.

## Repository layout

```text
apps/
├── api/          Fastify HTTP server (routes, auth, container wiring)
└── web/          React + Vite + Tailwind Drive UI
packages/
├── core/         Domain logic: services, storage abstraction, repositories
├── telegram/     TelegramStorageProvider + MTProto connection management
├── database/     Prisma schema, migrations, repository implementations, seed
├── shared/       DTOs, error codes, the search query parser, MIME helpers
└── sdk/          @lacrous/omnicloud — the published developer SDK
```

`packages/core` depends only on `packages/shared`; it never imports Prisma or
Telegram. That boundary is deliberate — the application talks to repository
interfaces and the `StorageProvider` abstraction, and everything concrete lives
at the edges.

## The commands

```bash
pnpm dev            # run API + web together
pnpm build          # build types, SDK bundle and web app
pnpm test           # every package's test suite
pnpm lint           # ESLint across the workspace
pnpm typecheck      # tsc --noEmit everywhere
pnpm format         # Prettier write
pnpm db:generate    # regenerate the Prisma client
pnpm db:migrate     # apply migrations
pnpm db:seed        # seed a local user with folders/files (dev only)
```

Before opening a pull request, `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
should all pass — that is exactly what CI runs.

## Testing

Tests live next to the code they cover (`packages/*/test`, `apps/api/test`) and
run on Vitest.

- **Unit tests** cover the domain services, the search query parser, the storage
  engine (retries, progress, cancellation) and MIME handling, using in-memory
  repository implementations in `test/fakes.ts`.
- **API tests** drive the real Fastify app through `app.inject()` with in-memory
  repositories and a fake storage provider, including the complete end-to-end
  user journey (create folder → upload → search → rename → move → star →
  download → trash → restore → replace → delete).
- **Telegram tests are isolated.** The normal suite never needs a Telegram
  account; the live provider test is skipped unless you set the documented
  `OMNICLOUD_LIVE_*` environment variables.

When you fix a bug, add a regression test that fails without your fix.

## Code conventions

- TypeScript strict, with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`
  — use `import type` for type-only imports.
- Prettier: double quotes, 100-column width, semicolons (see `.prettierrc`).
- ESLint: typescript-eslint recommended plus the React hooks rules for the web
  app. No `any` in new code; no `console.log` left behind.
- Match the surrounding style — the codebase favors small, single-purpose
  modules, explicit types at public boundaries, and comments only where they
  explain a non-obvious constraint.

## Reliability rules

These are load-bearing invariants in v0.2 — changes must preserve them:

1. **Metadata is written only after the storage operation succeeds.** A row in
   `files` means the bytes are really in the channel.
2. **Permanent deletion removes the remote object before the metadata.** If the
   remote delete fails, the metadata is kept so the user can retry.
3. **Ownership is always derived server-side.** Never trust a client-supplied
   `user_id`; records owned by someone else are reported as `404`, not `403`.
4. **Telegram sessions never leave the server** and never appear in logs.
5. **Nothing is repaired or deleted silently.** The integrity checker is
   read-only; repairs are explicit and separate.
6. **Failures are observable** — use the structured error codes and include
   context in logs rather than swallowing errors.

## Documentation

User-facing docs live in `docs/` (`api.md`, `architecture.md`, `telegram.md`,
`storage-provider.md`, `sdk.md`, `deployment.md`, `troubleshooting.md`,
`security.md`). If your change alters an endpoint, an environment variable, or a
behavior those pages describe, update them in the same pull request. Note that
`docs/api.md` is the authoritative API reference.

## Commits and pull requests

- Keep commits focused; a short imperative subject line and a body explaining
  _why_ when the change is not obvious.
- One logical change per pull request. Describe what changed, how you verified
  it, and any follow-up work you deliberately left out.
- For larger changes or anything that alters the architecture, open an issue
  first so we can agree on the approach before you invest in it.

## What is out of scope for v0.2

To keep the reliability foundation solid, these are intentionally not part of
v0.2: public sharing and public links, multi-user collaboration, mobile/desktop
apps, sync clients, end-to-end encryption, file previews as a subsystem,
alternative storage providers (S3, WebDAV), Redis, Elasticsearch, Kubernetes,
microservices, and distributed workers.

## License

By contributing you agree that your work is licensed under the project's
[MIT License](LICENSE).
