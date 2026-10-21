# OCE1 known-answer vectors and cross-client verification

**Date:** 2026-10-18
**Package:** `@omnicloud/crypto` (OCE1 v1)
**Status:** verified — all results below were reproduced in this repository on the stated date.

## What is verified

### Committed known-answer vector set (`packages/crypto/test/vectors/v1.json`)

Fixed, non-secret test inputs:

- URK / DEK / file id / version id (fixed hex constants)
- chunk size 64, key epoch 0, deterministic nonce sequence
- recovery code (fixed hex) + fixed recovery nonce

Committed expected outputs (all hex-encoded):

| Output              | Direction                                                             |
| ------------------- | --------------------------------------------------------------------- |
| `kekHex` / `mekHex` | HKDF-derived key-encryption and metadata-encryption keys from the URK |
| `envelopeHex`       | chunked XChaCha20-Poly1305 file envelope (encrypt direction)          |
| `wrappedKeyHex`     | DEK wrapped under the KEK                                             |
| `metadataBlobHex`   | encrypted metadata (name, MIME type)                                  |
| `recovery.blobHex`  | URK wrapped under the recovery-code-derived key (encrypt direction)   |

Round-trip directions covered by tests and by the standalone verifier:

- `decryptFile` on the committed envelope recovers the committed plaintext and metadata byte-for-byte.
- `openRecoveryBlob` on the committed recovery blob recovers the committed URK byte-for-byte.

The recovery KAT uses an explicit test-only nonce parameter on `createRecoveryBlob` (the same deterministic-injection pattern the envelope already used via `nonceFactory`); production callers omit it and get a random nonce.

### Cross-client (Web ↔ Node) agreement

Both clients consume the **same** `@omnicloud/crypto` TypeScript source: Node via `tsx`, the web app via Vite's esbuild transform. The cross-client check executes the identical verifier in two real runtimes:

1. **Node** — `pnpm run verify:vectors` (recomputes all outputs, checks all round trips; 9/9 fields PASS).
2. **Headless Firefox** — `pnpm run verify:vectors:cross-client` bundles `scripts/browser-entry.ts` with esbuild (`format: iife`, `platform: browser`, `target: es2022`), loads it in real Firefox through geckodriver, and reads back every recomputed output.

The orchestrator requires Node and Firefox to agree **byte-for-byte** on all six recomputed outputs (`kek`, `mek`, `envelope`, `wrappedKey`, `metadataBlob`, `recoveryBlob`) and requires both to match the committed vector file.

## Results of this run (2026-10-18)

```
node:   PASS kek, mek, envelope, wrappedKey, metadataBlob, recoveryBlob,
        decryptPlaintext, decryptMetadata, openRecoveryUrk   (9/9)
firefox: pass=true (all fields)
PASS output kek identical in node and firefox
PASS output mek identical in node and firefox
PASS output envelope identical in node and firefox
PASS output wrappedKey identical in node and firefox
PASS output metadataBlob identical in node and firefox
PASS output recoveryBlob identical in node and firefox
ALL PASS (node == firefox, both == committed vector)
```

Environment: Node (repo toolchain), Firefox headless via `/snap/bin/geckodriver`.

The vitest suite (`packages/crypto/test/vectors.test.ts`) re-derives the full vector on every CI run and fails on any byte drift, so CI permanently guards this set.

## How to reproduce

```bash
pnpm --filter @omnicloud/crypto run verify:vectors            # Node side
pnpm --filter @omnicloud/crypto run verify:vectors:cross-client  # + Firefox (needs firefox & geckodriver)
pnpm --filter @omnicloud/crypto test                          # includes committed-vector tests
```

## Not covered

- The **actual production web bundle** (`apps/web` Vite dist) is not executed in a browser here; the browser leg uses the same source and the same esbuild transform pipeline that Vite drives, in a real Firefox JS runtime.
- No Android/native implementation exists yet (M8); this vector set is the contract it must satisfy later.
- Vectors are generated with `@noble/ciphers` / `@noble/hashes` only; they say nothing about the security of the overall protocol design (that is the independent review's scope, see `docs/audits/encryption-review.md`).
