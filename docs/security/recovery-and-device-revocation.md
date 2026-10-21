# Recovery and Device Revocation — Design and Current State

**Status:** The recovery mechanism described here is **implemented provisionally and is not independently reviewed**. Device enrollment is designed only; device revocation beyond session revocation is not implemented. Treat everything here as pending cryptographic review, per [`encryption-protocol-v1.md`](encryption-protocol-v1.md).

**Implements:** roadmap Phase 9.2 (recovery) and Phase 14.1 (this document).

## 1. What exists today

| Capability                                                         | State                                                                         |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Recovery code generation, recovery record storage, key restoration | **Implemented (provisional)** — Web client, SDK crypto package, API, database |
| Authentication recovery (Telegram login)                           | Existing; independent of encryption recovery                                  |
| Trusted-device enrollment (approve a new device from an old one)   | **Not implemented** — design below                                            |
| Device revocation of API/session access                            | Existing (`logout`, `logout-all`)                                             |
| Cryptographic device revocation (key epochs)                       | **Not implemented** — design below                                            |
| Account password reset restoring encryption keys                   | **Never possible by design** — see §5                                         |

## 2. Recovery container (normative)

The recovery record is a fixed-size 72-byte ciphertext that the server stores on the user row (`User.recoveryBlob`, base64 in the API) and **cannot open**:

```text
recoveryBlob (72 bytes) = nonce(24) || XChaCha20Poly1305(RK, nonce, URK, AAD)

AAD = "OCE1" || 0x01 || 0x01 || u32be(keyEpoch) || 0x04
      (magic, format version, suite, key epoch, AAD type 0x04 = recovery)

RK  = HKDF-SHA256(ikm = code32, salt = "omnicloud-e2ee-v1",
                  info = "omnicloud/e2ee/v1/recovery", length = 32)
```

- **Recovery code**: 256 random bits, displayed as eight groups of eight hex characters (`xxxxxxxx-…-xxxxxxxx`). Parsers accept any spacing/case; exactly 64 hex characters are required. The code never leaves the client device.
- **URK**: the user root key from the OCE1 key hierarchy.
- The blob binds the format version, suite, and key epoch as authenticated context; a blob cannot be confused with any other OCE1 container (distinct AAD type `0x04`).

Reference implementation: `packages/crypto/src/recovery.ts` (unit-tested in `packages/crypto/test/recovery.test.ts`).

## 3. Recovery flow

1. With an active encryption key, the user chooses **Generate recovery code** in Settings → Encryption.
2. The browser generates the code and the sealed record, shows the code **once**, and uploads only the 72-byte ciphertext (`PUT /api/auth/recovery`).
3. The server validates base64 length only and stores it. It never receives the code.
4. To restore: the user signs in to their account (authentication), enters the code, and the client fetches the ciphertext (`GET /api/auth/recovery`), opens it with the code, and unlocks the key into memory. `DELETE /api/auth/recovery` removes the record.

Both factors are required: the ciphertext alone is useless without the code, and the code alone is useless without the ciphertext (fetched only with an authenticated session).

## 4. What this protects against — and what it does not

**Protects against**

- Server/database compromise alone: the attacker obtains only a sealed blob (256-bit code space; offline guessing is infeasible).
- Account session theft alone (without the code): no key material is reachable through the API.
- Loss of the browser tab: the key is recoverable with account access + code.

**Does not protect against**

- An attacker who obtains **both** the account session **and** the code (they can restore the key). Store the code offline, apart from account credentials.
- Malware on an authorized device while the key is unlocked.
- A compromised Web deployment serving malicious JavaScript (see the [trust model](../security.md#trust-model) — the browser delivery risk documented in the roadmap).
- Loss of **both** key and code: encrypted data is then permanently unrecoverable. This is intentional; the server must never be able to recover it.

**Account recovery vs encryption recovery.** Resetting or recovering the Telegram account restores _authentication only_. It does not restore the root key. The UI and this document must keep stating that distinction; do not claim otherwise.

## 5. Device enrollment (design — not implemented)

A new device must not gain decryption access from account password/login alone. The intended protocol (pending review):

1. The new device displays a short-lived, high-entropy enrollment request (QR + short code) containing an ephemeral public key and transcript nonce.
2. An already-trusted device scans/approves it over an end-to-end authenticated channel; the API only relays ciphertext. Both sides verify account identity, device names, and the transcript before accepting.
3. The approving device wraps the URK (or a URK-container) to the new device's ephemeral key; replay and man-in-the-middle attempts fail transcript binding.
4. Optional user confirmation on both devices; every enrollment is audited without secrets.

Open questions before implementation: key-agreement primitive selection, relay message format, QR payload schema, and whether the API learns any public keys (it may, as opaque relay data).

## 6. Device revocation (partial today)

- **Implemented:** revoking browser sessions (`POST /api/auth/logout`, `logout-all`) removes API access for those sessions. This is _authentication_ revocation only.
- **Not implemented:** cryptographic revocation. A device that already holds the URK retains the ability to decrypt data it can still reach. Excluding a compromised device cryptographically requires a key-epoch rotation: wrap all file keys under a new KEK, bump `keyEpoch` in envelopes, and re-wrap — costly and deferred.
- **Honest statement for docs/UI:** "Removing a device signs it out; it does not erase copies of keys or files already on that device."

## 7. Recovery-code lifecycle rules

- Codes are single-purpose secrets: never reuse them as passwords or API tokens.
- Regenerating invalidates the previous record (the blob is replaced; the old code no longer opens the new blob).
- Removing the record destroys recovery capability until a new code is generated.
- The code must never appear in logs, URLs, analytics, or error reports — the server never sees it at all.
- Display happens once; the client keeps it in memory only until the user confirms they saved it.

## 8. Required follow-ups before production

- [ ] Independent review of the recovery container (§2), including the AAD layout and HKDF parameters.
- [ ] Cross-client vectors: recovery blob must open identically from Web and SDK (`packages/crypto` is shared, so this is exercised by unit tests; add a fixed vector).
- [ ] Enrollment protocol review and implementation (§5).
- [ ] Key-epoch rotation design for cryptographic revocation (§6), or explicitly ship revocation as session-only with UI wording.
- [ ] Rate-limit and abuse review for the recovery endpoints.
- [ ] Document recovery semantics in user-facing docs (installation, encryption setup, troubleshooting).

## 9. API surface (provisional)

| Method   | Path                 | Auth                   | Body / Result                                                      |
| -------- | -------------------- | ---------------------- | ------------------------------------------------------------------ |
| `GET`    | `/api/auth/recovery` | session                | `{ recoveryBlob: string \| null }`                                 |
| `PUT`    | `/api/auth/recovery` | session + origin check | `{ recoveryBlob }` (base64, exactly 72 bytes) → `{ status: "ok" }` |
| `DELETE` | `/api/auth/recovery` | session + origin check | → `{ status: "ok" }`                                               |

The blob is opaque: the server validates alphabet and length only. Endpoints are rate-limited (20/min/IP) and covered by the same origin allowlist as other state-changing routes.
