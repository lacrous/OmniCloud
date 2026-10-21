# M4 live CLI smoke — evidence

**Date:** 2026-10-18
**Status:** verified — 27/27 checks passed on the first run against a live OmniCloud instance (real API on `127.0.0.1:4001`, real PostgreSQL, real Telegram storage).

**Script:** `packages/database/scripts/live-cli-smoke.ts`

```bash
node --env-file=.env apps/api/node_modules/tsx/dist/cli.mjs \
  packages/database/scripts/live-cli-smoke.ts http://127.0.0.1:4001 <api-server-log>
# exit 0 = all checks passed
```

The script runs the actual `omnicloud` CLI (`packages/sdk/src/cli.ts`) as a subprocess for every command — piped stdio for normal commands, a real pty (via `script -qec`) for the `--reveal` paths.

## Results (2026-10-18)

| #   | Check                                                               | Result          |
| --- | ------------------------------------------------------------------- | --------------- |
| 1   | api reachable                                                       | PASS (HTTP 200) |
| 2   | account with Telegram session and storage                           | PASS            |
| 3   | temporary API token minted (disposable, removed at the end)         | PASS            |
| 4   | `key generate --keyfile` exits 0                                    | PASS            |
| 5   | keyfile written at mode 600                                         | PASS            |
| 6   | key generate output has fingerprint, not the key                    | PASS            |
| 7   | `key status` prints the same fingerprint                            | PASS            |
| 8   | `key generate --reveal` refuses a non-TTY pipe (exit 1)             | PASS            |
| 9   | `upload <path> --encrypt` exits 0, real Telegram upload             | PASS            |
| 10  | DB row is OCE1                                                      | PASS            |
| 11  | DB row contains neither the URK nor the plaintext                   | PASS            |
| 12  | raw `download` is ciphertext (OCE1 magic)                           | PASS            |
| 13  | raw `download` output points the user at `--decrypt`                | PASS            |
| 14  | `download --decrypt` recovers the exact original bytes (128 KiB)    | PASS            |
| 15  | legacy plaintext upload accepted **via bearer token**               | PASS            |
| 16  | `migrate <id>` exits 0 and stores OCE1                              | PASS            |
| 17  | plaintext predecessor pruned (0 plaintext versions remain)          | PASS            |
| 18  | migrated file decrypts to the original bytes                        | PASS            |
| 19  | `recovery generate --reveal` under a pty exits 0 and shows the code | PASS            |
| 20  | recovery blob stored server-side (via bearer token)                 | PASS            |
| 21  | `recovery restore` under a pty recovers the same root key           | PASS            |
| 22  | API log contains no URK                                             | PASS            |
| 23  | API log contains no plaintext markers                               | PASS            |
| 24  | API log contains no recovery code                                   | PASS            |
| 25  | test files removed (DB)                                             | PASS            |
| 26  | pre-existing recovery record restored exactly                       | PASS            |
| 27  | temporary API token removed (DB)                                    | PASS            |

`M4 SUMMARY {"total":27,"passed":27,"failed":[]}` — process exit 0.

## What this demonstrates

- The CLI's secret-handling guards hold in practice: `--reveal` on a pipe is refused, key material never appears in command output, and the keyfile lands at mode `0600`.
- Encrypted upload through the CLI produces server/DB state that contains no plaintext and no root key; the stored bytes are OCE1 ciphertext.
- Download fidelity: raw mode yields ciphertext, `--decrypt` yields byte-identical plaintext.
- `migrate` against the live API performs the verify-then-delete flow end to end (plaintext predecessor pruned only after successful decryption).
- The bearer-token path on `/api/auth/recovery` (added for the CLI) works against the real API and does not leak the recovery code into server logs.
- Recovery round-trip: generate under a pty → blob stored → restore under a pty → identical root key.

## Not covered in this run

- **`migrate all`** — deliberately not run: it would encrypt any pre-existing plaintext files in this account. Its enumeration logic is unit-tested (`cli-e2ee.test.ts`); single-file migration is proven live here and in M2.
- **`login` / `logout`** — covered by unit tests only (the smoke injects the config file directly instead of prompting).
- **Concurrent/interrupted CLI transfers** — not exercised; SDK-level retry behavior is covered by the SDK suite.
- Windows/macOS terminal behavior of `--reveal` and the muted prompt (Linux pty only).
