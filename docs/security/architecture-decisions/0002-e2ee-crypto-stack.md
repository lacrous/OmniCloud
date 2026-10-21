# ADR 0002: E2EE Crypto Stack for OCE1

- **Status:** Accepted provisionally for implementation; independent cryptographic review still required before production enablement
- **Date:** 2026-10-17
- **Related:** [`encryption-protocol-v1.md`](../encryption-protocol-v1.md), [`architecture-decisions/0001-e2ee-platform-and-library-evaluation.md`](0001-e2ee-platform-and-library-evaluation.md), [`../crypto-library-research.md`](../crypto-library-research.md)

## Decision

Implement OCE1 with:

- `@noble/ciphers@1.3.0` (MIT) for XChaCha20-Poly1305.
- `@noble/hashes@1.8.0` (MIT) for HKDF-SHA256 and SHA-256.
- A dedicated client-only workspace package `@omnicloud/crypto` following the conventions of `packages/core`/`packages/shared` (source-exporting TypeScript, vitest).

Pinned npm integrity (verified 2026-10-17):

- `@noble/ciphers@1.3.0`: `sha512-2I0gnIVPtfnMw9ee9h1dJG7tp81+8Ob3OJb3Mv37rx5L40/b0i7djjCVvGOVqc9AEIQyvyu1i6ypKdFw8R8gQw==`
- `@noble/hashes@1.8.0`: `sha512-jCs9ldd7NwzpgXDIf6P3+NrHh9/sD6CQdxHyjQI+h/6rDNo88ypBxxz45UDuZHz9r3tNz7N/VInSVoVdtXEI4A==`

Use the v1 line of both libraries, not v2: v2 is ESM-only and requires Node >=20.19, while the SDK declares `engines.node >=20`; v1 supports ESM and CJS and older Node 20 runtimes.

## Why not libsodium secretstream

The isolated prototype showed JS/Web↔Node interop works, but no published `libsodium.js` release provides supported stream-state release (`free()` is master-only, unreleased). Long-lived clients would leak WASM heap allocations and leave key-bearing stream state unzeroed. See the research note for evidence.

## Why not custom AES-GCM chunking

AES-GCM's 96-bit nonce makes safe random nonces infeasible at scale and forces counter/state management, which reintroduces the resume/crash state problem. XChaCha20-Poly1305's 192-bit nonces allow independent random per-record nonces with negligible collision risk, removing persistent stream state from the design.

## Accepted risks

- OmniCloud-specific framing/AAD/manifest design is new and needs independent review (tracked in the protocol doc's gates).
- JS implementations cannot guarantee constant-time execution (documented limitation of all JS crypto; applies to noble).
- The pinned versions' reported Cure53 audit (v1.0.0, Sep 2024) does not automatically cover v1.3.0 or the OCE1 framing.
- No Android implementation exists; a later native implementation must reproduce the OCE1 vectors.

## Consequences

- `packages/crypto` becomes a dependency of the SDK and Web clients only. Server packages must never import decryption paths.
- Any format change bumps the OCE1 version byte and regenerates vectors.
