# M1 — Live End-to-End Encryption Smoke Test

**Date:** 2026-10-18
**Status:** **29/29 checks passed.** All results below are _verified live_ against a running stack (real API process, real PostgreSQL, real Telegram storage) — not mocks.
**Runner:** `packages/database/scripts/live-e2ee-smoke.ts` (committed; re-runnable).

## Command

```bash
node --env-file=.env apps/api/node_modules/tsx/dist/cli.mjs \
  packages/database/scripts/live-e2ee-smoke.ts \
  http://127.0.0.1:4001 \
  <path-to-API-process-log>
```

Exit code 0 = every check passed. The script creates its own disposable browser session, files, and recovery record, then removes them in a `finally` block.

## Environment

| Component   | Detail                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| API         | `tsx watch` on `127.0.0.1:4001`, health 200                                                                              |
| Database    | local `omnicloud-postgres`, migrations 1–9 applied                                                                       |
| Telegram    | real account (`user=lacrous`) with live MTProto session and storage channel                                              |
| Crypto      | `@omnicloud/crypto` OCE1, chunk size 64 KiB (4 chunks + manifest for the 200 KiB fixture)                                |
| Runner auth | session minted exactly like the app (32-byte base64url token, SHA-256 hash row) with a 1-hour TTL; deleted after the run |

## Results

### Pipeline (verified)

| #   | Check                                            | Result | Evidence                                                                                                |
| --- | ------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------- |
| 1   | API reachable                                    | PASS   | HTTP 200                                                                                                |
| 2   | Account with Telegram session + storage          | PASS   | user `lacrous`                                                                                          |
| 3   | Temporary session minted                         | PASS   | same construction as `AuthSessionService.issue`                                                         |
| 4   | Legacy upload stores `encryptionFormat=null`     | PASS   | pre-existing behavior intact                                                                            |
| 5   | Encrypted upload accepted as OCE1                | PASS   | DTO `encryptionFormat="OCE1"`, `keyEpoch=0`                                                             |
| 6   | Metadata endpoint round-trips opaque fields      | PASS   | `wrappedKey` 96 chars, `metadataBlob` 136 chars, unchanged                                              |
| 7   | DB row has OCE1 fields                           | PASS   | columns present, lengths as expected                                                                    |
| 8   | **DB row contains no URK**                       | PASS   | raw row JSON searched for the URK hex                                                                   |
| 9   | **DB row contains no plaintext**                 | PASS   | marker string absent                                                                                    |
| 10  | **Downloaded object starts with `OCE1` magic**   | PASS   | 205,100 bytes streamed **from Telegram** through the API — the stored object is the ciphertext envelope |
| 11  | Envelope size unchanged by storage               | PASS   | byte length equals the produced envelope                                                                |
| 12  | **Live download decrypts to original plaintext** | PASS   | all 204,800 bytes byte-identical after decrypt                                                          |
| 13  | Encrypted metadata survives the trip             | PASS   | `metadata.name === "m1-smoke.bin"` after decryption                                                     |

### Negative cases (verified)

| #   | Check                      | Result | Evidence                                                           |
| --- | -------------------------- | ------ | ------------------------------------------------------------------ |
| 14  | Wrong key rejected         | PASS   | `AuthenticationError`                                              |
| 15  | Tampered envelope rejected | PASS   | last byte flipped on the downloaded object → `AuthenticationError` |

### Recovery record (verified)

| #   | Check                                                         | Result          |
| --- | ------------------------------------------------------------- | --------------- |
| 16  | Recovery record stored via `PUT /api/auth/recovery`           | PASS (HTTP 200) |
| 17  | GET returns the identical ciphertext                          | PASS            |
| 18  | The recovery code opens the record and restores the exact URK | PASS            |
| 19  | A different recovery code is rejected                         | PASS            |
| 20  | `DELETE` removes the record                                   | PASS            |

### Server blindness (verified)

| #   | Check                                       | Result | Method                                      |
| --- | ------------------------------------------- | ------ | ------------------------------------------- |
| 21  | Activity events contain no URK              | PASS   | JSON sweep of events created during the run |
| 22  | Activity events contain no recovery code    | PASS   | code never left the client                  |
| 23  | Activity events contain no plaintext marker | PASS   | content never recorded                      |
| 24  | **API process log contains no URK**         | PASS   | full `tsx watch` stdout/stderr log scanned  |
| 25  | API log contains no plaintext marker        | PASS   | same scan                                   |
| 26  | API log contains no recovery code           | PASS   | same scan                                   |

### Compatibility and cleanup (verified)

| #   | Check                                                | Result               |
| --- | ---------------------------------------------------- | -------------------- |
| 27  | Legacy plaintext file still downloads byte-identical | PASS                 |
| 28  | Test files removed from Telegram + DB                | PASS (`remaining=0`) |
| 29  | Temporary session removed                            | PASS                 |

## Defects found during M1

Two **script** defects were found and fixed before the passing run (missing object brace; base64 DTO strings passed to a `Uint8Array` API parameter). **No product defect was found by this run.** Both fixes are in the committed runner.

## Not covered by this run (assumed or unverified)

- **Multi-chunk resilience beyond the happy path:** interrupted Telegram upload mid-stream; large-file memory behavior (see plan M5).
- **Server-side tampering during flight:** tampering was applied to retrieved bytes, not injected by the API; a malicious-server scenario is covered by the protocol review (plan M3), not this run.
- **Cross-client interoperability beyond Web/Node implementations sharing `@omnicloud/crypto`:** Android does not exist yet.
- **Account takeover with recovery code:** single-factor threats remain as documented in `docs/security/recovery-and-device-revocation.md`.
- **One run, one account, one fixture size** (200 KiB / 4 chunks); no performance measurement.

## Reproduction notes

- Requires an initialized account (Telegram session + storage channel); the script reports which precondition is missing otherwise.
- The runner intentionally uses small chunks (64 KiB) to exercise multi-chunk + manifest paths without multi-megabyte fixtures.
- The URK and recovery code are generated by the run and discarded; they are not persisted anywhere.
