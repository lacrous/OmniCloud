# ADR 0001: E2EE Platform and Cryptographic Library Evaluation

- **Status:** Proposed; no implementation or dependency selected
- **Date:** 2026-10-17
- **Decision owners:** OmniCloud maintainers, with independent cryptographic review required
- **Related:** [`encryption-protocol-proposal.md`](../encryption-protocol-proposal.md), [`encryption-requirements.md`](../encryption-requirements.md), [`threat-model.md`](../threat-model.md), [`crypto-library-research.md`](../crypto-library-research.md)

## Context

The current repository is a pnpm TypeScript monorepo with `apps/api`, `apps/web`, and packages including `core`, `database`, `sdk`, `shared`, and `telegram` (`pnpm-workspace.yaml:1-3`). The Web app uses React 18, Vite 6 and TypeScript 5 (`apps/web/package.json`). The SDK/CLI targets Node.js >=20 and is bundled with tsup (`packages/sdk/package.json:25-48`). There is no Android app/package in the inspected workspace.

The inspected manifests and lockfile did not identify a dedicated cryptographic dependency for client-side file encryption, a shared protocol package, or an Android cryptographic implementation. The existing Node `SecretBox` uses built-in Node crypto for server-side Telegram session strings; it is not a portable file-encryption protocol (`packages/core/src/utils/secret-box.ts`). No package installation, dependency update, external library security claim, or performance measurement was made for this ADR.

The E2EE requirements include browser + Node + Android interoperability, large-file streaming, authenticated chunk completion, safe nonce behavior, key wrapping, recovery, and controlled migration. These constraints cannot be satisfied safely by selecting a library based only on API familiarity or primitive names.

## Decision

**Do not select or add a cryptographic library in this ADR.** First evaluate supported libraries and constructions against the criteria below and obtain protocol review. No production cryptographic code or production object format may be based solely on this draft.

Adopt these architectural constraints for the evaluation:

1. Define one canonical, versioned, language/platform-independent protocol specification and canonical serialization. It is the source of truth for every client.
2. Evaluate a TypeScript implementation for Web and Node only if its browser and Node behaviors are the same protocol and can be tested using shared vectors. Keep platform-specific key storage behind client interfaces.
3. Keep Android implementation choice open. No Android target currently exists in the workspace; choose Kotlin/Compose or React Native after testing actual library/runtime/Keystore/background-transfer behavior. Android MUST conform to the same protocol vectors, not invent a different file format.
4. Keep cryptographic implementation in a dedicated package boundary (candidate workspace name `@omnicloud/crypto` or equivalent, subject to existing naming conventions and package publishing needs), separate from storage/provider code. Protocol schemas/vectors may be a distinct package or live beside the implementation; decide after reviewing API/export requirements.
5. The API, core storage, database and Telegram packages MUST NOT depend on decryption keys. They may persist and forward ciphertext and non-secret protocol metadata.
6. Preserve existing upload/download/version/idempotency/reconciliation services and add encrypted-object behavior incrementally only after protocol approval.

## Evaluation matrix

Candidates must be compared with evidence on these dimensions. The linked research note (`../crypto-library-research.md`) identifies libsodium secretstream as the first prototype candidate based on its documented chunk-stream semantics, not as an accepted production choice. It must pass Android compatibility, browser bundle/performance, exact-version supply-chain, and independent-review gates. If it fails, evaluate a common-AEAD protocol as the alternative, recognizing that OmniCloud would own more stream-format and nonce logic.

| Criterion               | Required evidence                                                                                                                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Construction            | Exact reviewed construction, intended use, threat assumptions, limitations, and evidence that library APIs implement it correctly.                                                                                                                    |
| Browser support         | Supported browsers, secure-context requirements, CSPRNG source, key import/export behavior, typed-array/stream behavior, worker compatibility, and error semantics.                                                                                   |
| Node support            | Node >=20 behavior, CSPRNG, streaming/file input, worker support, packaging/module compatibility, and memory/secret handling limits.                                                                                                                  |
| Android support         | Supported Android versions, native implementation quality, Keystore integration boundaries, background execution, and hardware-backed availability reporting.                                                                                         |
| Chunked operation       | Whether the library supplies a reviewed streaming/record construction with authenticated finalization, or what additional protocol design is needed. Reject an assumption that repeated independent AEAD calls alone provide complete-file integrity. |
| Nonce discipline        | Who generates nonces, uniqueness guarantee per key, behavior on crash/retry/resume, limits and failure modes, and conformance tests.                                                                                                                  |
| Key management          | Supported KDF/key wrapping, context separation, parameter validation, versioning, and avoidable custom glue.                                                                                                                                          |
| Interoperability        | Published vectors across Web/Node/Android, canonical serialization, byte-for-byte test fixtures, invalid vectors and version handling.                                                                                                                |
| Security review         | Independent audit/review scope, date, version reviewed, unresolved findings and applicability to the APIs/version actually proposed. Library reputation alone is not enough.                                                                          |
| Supply chain            | Package provenance, maintainers, release cadence, dependency graph, native/WASM artifacts, build reproducibility/provenance, known advisories, license and update process.                                                                            |
| Performance             | Measured throughput, peak memory, battery/CPU, binary/bundle size, representative device/browser matrix and large-file results.                                                                                                                       |
| Maintenance and license | Active maintenance, support policy, license compatibility, upgrade/migration commitments and incident response.                                                                                                                                       |

## Platform observations and trade-offs

### Web

The existing application has no declared crypto dependency. Browser-provided cryptographic APIs may reduce dependency burden for some operations, but availability and semantics do not alone satisfy the protocol requirements, particularly streaming encryption/finalization and cross-platform behavior. A library using WASM or JavaScript brings supply-chain, bundle and audit considerations. Any selected implementation must work in actual supported browsers and must not persist raw keys in web storage.

The API's current web client is delivered as JavaScript. A compromised deployment could serve malicious key-stealing code; no crypto library can remove that trust boundary. Web support should therefore be evaluated separately from claims about native/CLI security.

### Node.js SDK/CLI

The SDK currently targets Node >=20 and already uses Node stream/file interfaces. Native Node crypto can be useful but is not automatically interoperable with browser or Android APIs or with a reviewed streaming format. A viable option must package safely in ESM and CommonJS, coexist with current tsup builds, avoid keys in CLI arguments/config, and document managed-runtime memory limits.

### Android

There is no Android application/package today. React Native may allow some code sharing but still requires verifying native crypto modules, their API/nonce behavior, native build supply chain and Android Keystore integration. Kotlin offers direct platform integration but requires a separate implementation that passes identical vectors. No decision can be made without a tested prototype on real devices and the supported OS matrix.

### Shared package placement

`packages/shared` currently contains shared TypeScript definitions and does not depend on crypto. Putting cryptographic code there without clear boundaries risks coupling API/server code and inviting accidental key processing in server paths. Prefer a dedicated client crypto package and explicit API DTOs for opaque envelopes; do not make the API depend on the decryption implementation. Whether the protocol schemas/vectors are a separate workspace package remains open.

## Rejected premature decisions

- **Choose AES-GCM and build a custom chunk format now:** rejected. Primitive familiarity does not resolve streaming finalization, nonce uniqueness across resume, manifest authentication, or cross-platform consistency.
- **Use one JavaScript implementation everywhere:** rejected as an assumption. Android runtime/library/security behavior is unverified and may not meet Keystore, streaming, or lifecycle needs.
- **Use Web Crypto alone as the full protocol:** not accepted without demonstrating streaming, format, finalization, and Android/Node interoperability against the actual requirements.
- **Put encryption in `packages/core`:** rejected as the default boundary because `core` is used by server services; key-handling must remain visibly client-only. Any shared types can be separated from the client cryptographic implementation.
- **Add a dependency before review:** rejected. It creates supply-chain and API commitments before protocol and platform fit are established.

## Evaluation work required

1. Confirm supported browser versions and whether Web support is mandatory for the first encrypted beta.
2. Decide Android's intended first-release role and minimum supported OS before comparing frameworks.
3. Use [`../crypto-library-research.md`](../crypto-library-research.md) as an initial shortlist, not as final verification. Verify exact current package versions, licenses, maintenance, advisories, release provenance and audit scope; upstream claims must be checked against the versions actually evaluated.
4. Prototype libsodium secretstream via libsodium.js first for Web and Node, plus a compatible Android binding feasibility test. Lazysodium Android is a candidate to assess (upstream v5.2.0 states libsodium 1.0.20 support and recommends minimum API 24); verify exact API, ABI, artifact provenance and product minimum-SDK fit. Measure actual production-build bundle weight and performance. Compare a common-AEAD alternative only if Android compatibility, supply chain, or product constraints fail the libsodium candidate. Use no production/user data.
5. Create a minimal canonical vector runner usable from browser, Node, and Android. Include invalid ciphertext, tag, ordering, truncation, wrong key, unknown version and malformed-length vectors.
6. Benchmark representative sizes on browser, Node, and physical Android devices, measuring peak memory and elapsed time. Establish initial product thresholds before calling performance acceptable.
7. Have a cryptographer or independent security reviewer examine the proposed protocol and library APIs before final selection. Incorporate feedback and record the review scope and unresolved findings.
8. Write a decision record naming the chosen library/construction/version, exact security assumptions, formats, nonce rules, migration plan, and rejected alternatives. Only then add the dependency and production implementation.

## Consequences

### Positive

- Avoids turning a roadmap candidate into an unreviewed design decision.
- Preserves current monorepo boundaries and server storage reliability work.
- Makes Android and Web threat differences explicit.
- Allows measured choice based on actual supported platforms and large-file behavior.

### Costs / open risks

- Delays implementation while protocol, library and platform evidence is gathered.
- A single shared protocol may still require multiple platform implementations and ongoing conformance testing.
- Web-delivered code remains a distinct trust risk even with a vetted library.
- No E2EE feature can be claimed until design and implementation release gates pass.

## Review checklist

- [ ] Supported browser matrix agreed.
- [ ] Initial Android scope/framework and minimum API decided based on tested options.
- [ ] Candidate library/construction comparison completed with pinned versions and evidence, including Android native binding/artifact provenance.
- [ ] Pinned JS wrapper release provides supported stream-state release (`free()` upstream; not present in 0.8.4) or an alternative binding with equivalent lifecycle control is verified.
- [ ] Streaming, nonce, finalization, and resume semantics reviewed.
- [ ] Canonical serialization and test vectors approved.
- [ ] Key storage, recovery and enrollment design reviewed.
- [ ] Independent protocol review completed and findings tracked.
- [ ] Decision updated to Accepted or Rejected before implementation.
