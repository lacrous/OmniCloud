# OmniCloud Execution Plan — Tiers 1–3

**Status:** Proposed plan for the next work cycle. Distinct from the master encryption roadmap: this document sequences the **recommended next increments** (verification gates → high-value features → product polish) against the actual state of the repository as of the OCE1 recovery work (`562779c`).

**Evidence baseline:** audit, threat model, OCE1 protocol, crypto package (51 tests), opaque-object API integration, SDK/Web encrypted upload-download, recovery records, landing page + i18n + SEO, Vercel + GitHub CI. All local gates green. **Never yet done live:** a real-Telegram encrypted roundtrip; independent cryptographic review.

**Rules inherited from the master roadmap:** no custom crypto, no plaintext fallback, no security claims beyond evidence, no irreversible migrations without verified copies, every result recorded as verified / assumed / not done.

---

## Sequencing overview

```text
M1 Live E2EE smoke ──► M2 Legacy migration ──► M3 External review ──► fixes ──► "reviewed" label
                              │
                              ├──────────────► M4 CLI encryption        (parallel after M2)
                              ├──────────────► M5 Streaming large files (parallel after M2)
                              └──────────────► M7 Polish (3.1–3.4 anytime, 3.5 after M5)
M6 Device enrollment ── design during M4/M5, implement after M3 findings are in
```

M1 is the foundation: it either validates or breaks the whole encrypted pipeline before more features build on it. M3 gates any production E2EE wording. Everything in Tier 3 is independent except 3.5 (previews need decryption, already available) and docs that claim review status (M3).

---

## Tier 1 — Verification gates

### M1 · Live end-to-end smoke test with real Telegram

**Why first:** every test so far runs against mocks/fakes. The Telegram storage seam is the one path never exercised with real encryption.

| Step                   | Detail                                                                                                                                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preconditions          | API `:4001` + web `:5174` running, Postgres up, migrations 1–9 applied, `api_id`/`api_hash` in `.env`                                                                                                                                     |
| Positive flow          | QR sign-in → generate key → enable _Encrypt new uploads_ → upload small (empty, <1 chunk) and medium (multi-chunk) files → badge shows Encrypted → download → byte-compare against original plaintext                                     |
| Server blindness check | `psql`: `encryptionFormat='OCE1'`; downloaded Telegram object bytes start with magic `OCE1`; grep API logs + DB for the URK hex → **zero hits**                                                                                           |
| Negative flows         | wrong-key download → hard error, no file saved; tamper one ciphertext byte (test account, disposable file) → authentication failure; upload with key active but toggle on after a plaintext file exists → legacy file stays `null` format |
| Recovery live check    | generate code → clear key → restore by code → download succeeds                                                                                                                                                                           |
| Legacy check           | a pre-encryption file still downloads normally as plaintext                                                                                                                                                                               |
| Evidence               | write `docs/audits/live-e2ee-smoke.md`: commands, screenshots/diffs, pass/fail per case, defects filed                                                                                                                                    |

**Exit:** all cases pass or defects are filed and fixed; evidence doc merged. **This unblocks M2/M3.**

### M2 · Legacy migration flow

Files: `packages/sdk/src/encryption.ts`, `apps/api` (reuse replace endpoint), `apps/web` (Drive UI + action menu), `docs/security/recovery-and-device-revocation.md` sibling migration doc.

1. **Design (short):** migration = download plaintext → `encryptFile` → replace-with-encryption (existing endpoint) → client re-downloads candidate → decrypt → byte-compare with source → only then delete the old plaintext version via existing `deleteVersion` (remote-object-first rules apply). Durable client operation record with states: `PENDING → ENCRYPTING → UPLOADING → VERIFYING → COMMITTED | FAILED(keep original)`. Crash at any point re-runs from stored state; never deletes before `COMMITTED`.
2. **SDK:** `migrateFile(id, { urk })` implementing the state machine; idempotent (same operationId on retry).
3. **Web:** per-file "Migrate to encrypted" (action menu) + bulk dialog "Encrypt N legacy files" with progress; filter/indicator for `encryptionFormat === null` (client-side filter first; server search filter only if cheap).
4. **Tests:** fake-repo core tests for the state machine (kill after each state); API integration proving old version survives a failed verification; SDK roundtrip; UI gated by web build.

**Exit:** a legacy file migrates with identical recovered plaintext, original plaintext object removed only after verification, failure keeps the original byte-for-byte, badge flips to Encrypted.

### M3 · Independent cryptographic review

**Package handed to reviewer:** `encryption-protocol-v1.md`, `recovery-and-device-revocation.md`, ADR 0001/0002, `packages/crypto` source + `test/vectors/`, `docs/audits/live-e2ee-smoke.md`, migration design, this plan.

Pre-work (must finish first): fixed KAT vector for the recovery container (checklist item), one documented cross-client vector set for Web↔Node, evidence doc from M1.

Process: engage reviewer (external cryptographer or qualified independent review service) → scope: protocol, key hierarchy, chunk/AAD/nonce design, recovery container, enrollment design draft → track findings in `docs/audits/encryption-review.md` (severity, fix, retest) → fix highs before any wording change.

**Exit:** review report published, all high/medium findings fixed and retested. Only then may docs/UI use "independently reviewed" language.

---

## Tier 2 — High-value features

### M4 · CLI encryption commands

Files: `packages/sdk/src/cli.ts`, `packages/sdk/src/encryption.ts`, `docs/sdk.md`.

- Commands: `key generate` / `key status` (prints code/key only with explicit `--reveal` on a TTY), `upload <path> --encrypt`, `download <id> --decrypt -o <path>`, `migrate <id|all>`, `recovery generate` / `recovery restore`.
- Secrets: interactive muted-echo prompts only; never argv, never env, never logs (roadmap rule 8); optional `0600` keyfile is an explicit opt-in with a documented threat note.
- `--encrypt` without an available key → hard failure, never plaintext fallback.
- Tests: extend `packages/sdk/test/cli.test.ts`; assert secret never appears in stdout/stderr; install-from-pack test already in release workflow covers the artifact.

**Exit:** clean-machine `npm i -g @hilbras/omnicloud` → encrypted upload/download/migrate against a local API, no secrets in output.

### M5 · Streaming large files

Files: `packages/sdk/src/encryption.ts` + `client.ts`, `apps/web/src/api/upload.ts` / `download.ts`, benchmarks in `docs/audits/test-evidence.md`.

1. **SDK first (Node):** stream plaintext → `encryptChunks` (already exists) → spool ciphertext to a `0600` temp file → existing multipart streaming upload replaying the same bytes on retry → delete spool after commit. Download: stream envelope from response → `decryptChunks` → write to disk incrementally. Peak RSS bounded by chunk size, not file size.
2. **Web second:** chunked encrypt from `File.slice` reader; ciphertext spool via OPFS where available, buffered fallback with a documented size ceiling; decrypt accumulates to Blob (browser save constraints) but no longer double-copies; document the honest limits in `known-limitations`-style notes inside the protocol doc.
3. **Benchmarks:** 1 GiB CLI upload (RSS ceiling, e.g. <300 MB), chunk throughput before/after; Web 500 MB on Chromium as the target.

**Status (verified):** shipped in `dd54dc2` + the memory test below.

| Measure                         | Result                                                     |
| ------------------------------- | ---------------------------------------------------------- |
| 1 GiB stream upload             | 4.0–17.4 MiB/s across runs, round-trip `roundTripOk: true` |
| 1 GiB stream download + decrypt | 7.2–14.9 MiB/s across runs                                 |
| Client peak RSS, 32 MiB file    | upload 231 MB / download 275 MB                            |
| Client peak RSS, 128 MiB file   | upload 271 MB / download 329 MB                            |
| Web 32 MiB (headless Firefox)   | 3.80 s, 8.4 MiB/s, envelope `OCE1`, OPFS spool             |
| Web 256 MiB (headless Firefox)  | 35.31 s, 7.2 MiB/s, envelope `OCE1`, OPFS spool            |

Throughput varies several-fold between runs on the same machine depending on
cache state and background load, so only the range is meaningful; the
`roundTripOk` round-trip result is the durable signal.

The web figures come from `apps/web/scripts/bench-web-streaming.mjs` and are
recorded in `docs/evidence/web-streaming-bench.md`. Both web sizes are at or
above `STREAM_MIN_BYTES`, so both exercised the chunked path, and throughput
stays flat across an 8× size increase (8.4 → 7.2 MiB/s). OPFS was available in
the test browser, so these numbers describe the OPFS spool path.

The memory figures are measured with the SDK client in a **separate process** from
the HTTP server (`packages/sdk/test/streaming-memory.test.ts`); an in-process
benchmark cannot attribute RSS between client and server. Peak RSS is flat within
~17% across a 4× file-size increase and `heapUsed` stays near 7 MB, so the
stream is bounded by the 4 MiB chunk size rather than the file size. The residual
~200 MB is V8/Buffer high-water retention, so an absolute ceiling is
allocator-dependent; the ratio between file sizes is the durable assertion.
`bench-streaming.ts` no longer emits RSS fields for the same reason.

**Not verified (web):** browser heap could not be sampled — Firefox does not
expose `performance.memory`, so the browser memory ceiling is evidenced
indirectly by flat throughput rather than measured. The buffered-Blob fallback
(browsers without OPFS) was not exercised. The original plan wording said
Chromium; no Chromium is installed here, so the measurement was made in Firefox
and is labelled accordingly.

**Exit:** large-file path verified with recorded numbers; existing small-file behavior unchanged; resume-after-interrupt test (kill mid-upload, retry does not duplicate).

### M6 · Trusted-device enrollment

Design during M4/M5 (ADR), implement after M3 so review feedback shapes it.

- ADR: ephemeral X25519 (or reviewed alternative), short QR payload with transcript nonce, API as opaque relay with TTL + rate limits, both-device confirmation, binding to account identity.
- Crypto package: request/approve/wrap functions + negative vectors (replay, wrong account, MITM transcript mismatch).
- API: relay endpoints (opaque blobs, expiry, per-user quotas); Web: scan/approve UI.
- Honest revocation wording in UI: session removal ≠ cryptographic erasure (key-epoch rotation stays a documented future item unless scope expands).

**Exit:** second browser restores the URK only via approval from a first device; vectors ready for future Android; abuse tests on the relay.

---

## Tier 3 — Product polish

| ID  | Work                                                                                                                                                                                                                                                    | Notes / dependencies                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 3.1 | **Custom domain** — centralize origin as `VITE_SITE_URL` (fallback to current) in `lib/seo.ts`, `index.html` OG/JSON-LD, `robots.txt`, `sitemap.xml`; document DNS steps in deployment docs                                                             | User adds the domain in Vercel; one find-replace after                                             |
| 3.2 | **npm publish `@hilbras/omnicloud`** — published as v0.4.0 from `Hilbras/OmniCloud`; the release workflow verifies the tag against every manifest, builds, smoke-tests the packed tarball in a clean project, publishes, and creates the GitHub release | Done — see the release notes; `@lacrous/omnicloud` is deprecated in favour of `@hilbras/omnicloud` |
| 3.3 | **Docs sync** — CHANGELOG Unreleased entry (recovery, landing/i18n/SEO, mobile fix, rebrand), README features/security section update, `docs/sdk.md` encryption+recovery examples, roadmap-gates status table                                           | Anytime; keep claims within evidence                                                               |
| 3.4 | **Bundle trim** — measure rollup chunks, route-level splits already lazy; target main chunk < 350 KB gzip basis documented with before/after numbers                                                                                                    | Anytime; no behavior change                                                                        |
| 3.5 | **Encrypted previews** — when key active and format OCE1: download → decrypt → in-memory thumbnail (`createObjectURL`, revoke after), images/videos first, size cap, no plaintext cached                                                                | After M5 preferred (streaming decrypt); never for legacy files without their own flow              |
| 3.6 | **Ops notes** — document in-memory rate limiter limitation, recoveryBlob backup expectations (server backup = ciphertext only), health endpoint guidance                                                                                                | Documentation only                                                                                 |

---

## Cross-cutting gates (every milestone)

1. `format:check`, `lint`, `typecheck`, `pnpm -r test`, `build` locally → CI green on `Hilbras/OmniCloud`.
2. Push → Vercel preview verified before merging to `main` behavior claims.
3. Any storage-path change re-runs the M1 live checks on disposable files.
4. No claim in docs/UI without a passing test or recorded live evidence; mark everything else "not verified".
5. No npm publishing or irreversible data migration without explicit user authorization (roadmap rule 15).

## Risks

| Risk                                              | Mitigation                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------- |
| Browser streaming complexity (OPFS/reader limits) | SDK-first delivery; Web ships with documented ceiling, not a broken promise |
| Enrollment protocol flaw                          | Design ADR + review before code; reuse M3 reviewer if available             |
| Review delay stalls marketing wording             | Tiers 2–3 continue; wording gate stays closed until M3 exits                |
| Migration data loss                               | Verified-copy-before-delete state machine + crash tests (M2)                |
| npm scope/token mistakes                          | Manual verification of `@hilbras` scope ownership before tagging            |
| Scope creep (Android, sharing, search)            | Explicitly excluded below                                                   |

## Out of scope for this plan

Android app (roadmap Phase 8), file sharing (Phase 10), encrypted server-side search, key-epoch cryptographic revocation (designed, not committed here), desktop clients. These remain in the master roadmap after this cycle.

## Definition of done for this plan

- M1–M3 exit criteria met: live evidence published, migration reliable, review findings fixed.
- M4–M5: CLI and streaming verified with recorded benchmarks.
- M6: second-device enrollment tested; vectors shared.
- M7: canonical URLs, published npm package, docs current with evidence-based claims.
- All verification recorded as verified/assumed/not-done per roadmap §21.16.

## Roadmap gates status

Roadmap §21.16 requires every result to be recorded as verified, assumed, or
not done. Current state:

| Gate                                | Status       | Evidence                                                                                                                                                                                                              |
| ----------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 live E2EE round trip             | **Verified** | `docs/audits/live-e2ee-smoke.md` (29/29, real Telegram)                                                                                                                                                               |
| M2 legacy migration                 | **Verified** | `docs/audits/m2-migration-smoke.md` (14/14)                                                                                                                                                                           |
| M3 independent cryptographic review | **Not done** | `docs/audits/encryption-review.md` — package assembled, no reviewer engaged                                                                                                                                           |
| M4 CLI encryption commands          | **Verified** | `docs/audits/m4-cli-smoke.md`                                                                                                                                                                                         |
| M5 streaming large files (SDK/CLI)  | **Verified** | `docs/evidence/streaming-memory.md`                                                                                                                                                                                   |
| M5 streaming large files (web)      | **Verified** | `docs/evidence/web-streaming-bench.md` (Firefox; see caveats)                                                                                                                                                         |
| M6 trusted-device enrollment        | **Not done** | Design ADR pending; blocked behind M3 by design                                                                                                                                                                       |
| 3.1 canonical URLs                  | **Verified** | `VITE_SITE_URL`; both default and custom builds checked                                                                                                                                                               |
| 3.2 npm publish                     | **Verified** | `@hilbras/omnicloud@0.4.0` published from the `Release` workflow on `Hilbras/OmniCloud`; installed from the live registry into a clean project — CLI reports `0.4.0`, ESM + CJS load, server bundle and types present |
| 3.3 docs sync                       | **Verified** | CHANGELOG `[Unreleased]`, README, sdk docs updated in this cycle                                                                                                                                                      |
| 3.4 bundle trim                     | **Verified** | `docs/audits/test-evidence.md` — main chunk 142 KB gzip, under the 350 KB target                                                                                                                                      |
| 3.5 encrypted previews              | **Verified** | Encrypted images/video decrypt in-tab; object URL revoked; plaintext never cached                                                                                                                                     |
| 3.6 ops notes                       | **Not done** | Documentation only; not started                                                                                                                                                                                       |

**Assumed, not verified:** that the protocol survives independent review. The
design is documented and internally consistent, but no external party has
examined it. Nothing in the product, README, or changelog claims otherwise.

**Known environment caveats:** no Chromium is installed, so the web benchmark
was recorded in headless Firefox; browser heap is not measurable there, so
browser memory is evidenced indirectly rather than sampled. The buffered-Blob
fallback path (browsers without OPFS) is code-guarded but untested.

**Known release-process caveat:** the `Hilbras` organisation does not run
workflows triggered by a push — not by a branch push, not by a tag push.
Pushing `v0.4.0` started no run, and a throwaway probe tag confirmed it; the
same holds for pushes to `main`, which start no `CI` run. `pull_request` and
`workflow_dispatch` triggers do work. The organisation's Actions policy is not
readable with the token this account has (403, `admin:org` required), so the
cause is not identified from here.

Two consequences, both worked around rather than ignored:

- **The `Release` workflow also accepts a manual dispatch** with the version
  to release (`gh workflow run release.yml --ref main -f version=0.5.0`). It
  still checks the version against every manifest, still checks out the tag,
  and still runs the full gate.
- **A direct push to `main` is not verified by CI on its own.** Run it by hand
  (`gh workflow run ci.yml --ref main`) or land the change through a pull
  request, which does trigger CI. `docs/release-checklist.md` records both
  paths.

Branch protection on `main` that requires the CI status check is the durable
fix, and it is viable here because pull requests do trigger CI. It has not been
enabled, because it changes how the repository is worked on and that is a
decision for the maintainers.
