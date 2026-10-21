# ADR 0003: Trusted-Device Enrollment Design (URK transfer)

- **Status:** Proposed — design only. **No enrollment code exists.** Independent
  cryptographic review is required before implementation begins, and this ADR is
  explicitly in that review's scope (item 4 of
  [`docs/audits/encryption-review.md`](../../audits/encryption-review.md)).
- **Date:** 2026-10-20
- **Related:** [`encryption-protocol-v1.md`](../encryption-protocol-v1.md),
  [`recovery-and-device-revocation.md`](../recovery-and-device-revocation.md),
  [`0002-e2ee-crypto-stack.md`](0002-e2ee-crypto-stack.md)

## Context

The user root key (URK) is generated once, on one device. It derives the KEK
that wraps every per-file DEK and the MEK that encrypts file metadata. Today a
second device can only obtain the URK through the recovery-code path, which
means a second device cannot bootstrap itself without either the recovery code
or a manual key transfer.

Roadmap §12.1 requires that a new device must not receive decryption access
merely because a user typed an account password, and that the protocol
authenticate both the intended device and the transferred key material.

## Decision (proposed)

Add a **device enrollment** flow: an already-trusted device approves a new one
by transferring the URK through an authenticated key agreement, relayed by the
API as an opaque, short-lived blob.

### Participants

- **Approver device (A)** — already holds the URK; generates a fresh enrollment
  key pair per enrollment.
- **Enrolling device (B)** — fresh or wiped; holds no URK yet.
- **API** — authenticated relay only. It stores and returns opaque ciphertext
  blobs with a TTL. It must never hold the URK, the transferred key, or any
  long-term device secret in the clear.

### Protocol sketch

Use ephemeral X25519 for the key agreement (per roadmap §12.1; the concrete
library choice must be added to ADR 0002's pinned set before implementation).

1. **B requests enrollment.** B generates an ephemeral X25519 key pair
   `(b_priv, b_pub)` and an enrollment nonce. B posts `{ b_pub, nonce, display
name }` to the API. The API returns an opaque `enrollment_id` and a short QR
   payload containing `enrollment_id`, the account handle A displays, and a
   checksum so A's scanner can detect a truncated/misdirected QR.

2. **A scans and approves.** A displays the enrollment id and B's display name
   for explicit human confirmation. On approval A generates an ephemeral pair
   `(a_priv, a_pub)`, derives a shared secret, and derives wrapping keys from
   it with HKDF bound to: the shared secret, `b_pub`, `a_pub`, `enrollment_id`,
   and both account identities — so the transcript is authenticated, not just
   the key agreement. A wraps the URK with a fresh content key and posts the
   resulting ciphertext to the API keyed by `enrollment_id`.

3. **B retrieves.** B polls the relay, derives the same wrapping key from the
   shared secret and the bound transcript, unwraps the URK, and **immediately
   re-encrypts it under its own local protection** (the new device's password-
   derived KEK or platform keystore). The URK exists unwrapped only briefly in
   B's memory.

4. **Both devices confirm** by displaying a short transcript fingerprint derived
   from the transcript. A mismatch aborts on both sides.

### Design constraints this ADR commits to

- **Approval is explicit and on-device.** A password or session token alone can
  never authorize a transfer.
- **The API is a relay, never a participant.** It holds opaque ciphertext with a
  TTL and per-user rate limits; it can neither read the URK nor mint an
  enrollment without A's approval material.
- **Transcript binding.** Derived wrapping keys bind both public keys, the
  enrollment id, and the account identities, so a MITM cannot substitute a
  different `b_pub` or redirect a transfer to another account.
- **Single use.** A completed enrollment is burned; the relay blob is deleted by
  A after B confirms retrieval, and expires on its own otherwise.

### Honest limitations (must appear in the UI, not just here)

- **Revocation is not erasure.** Revoking a device stops it from _obtaining
  future_ enrollments, but cannot recall a URK already copied to it. A device
  that was trusted and later compromised retains the ability to decrypt
  anything the URK unlocks.
- **No key-epoch rotation.** There is no mechanism to rotate the URK and
  rewrap every file DEK. Revocation that actually excludes a compromised device
  would require that, which is out of scope here (roadmap §12.3 lists it as a
  future item).
- **The approver is fully trusted at approval time.** Whoever holds an unlocked
  approved device can approve a new one; enrollment does not protect against an
  already-compromised approver.
- **A short QR is not a secret.** `enrollment_id` is not a bearer token to the
  URK — only the A-side ciphertext, which B cannot decrypt without the ephemeral
  shared secret, is stored.

## Consequences

- Enables a second browser/CLI to join an encrypted account without handing over
  the recovery code on every new device.
- Adds a relay with its own abuse surface (enumeration, blob flooding), which
  needs its own rate limits and TTL tests before release.
- Adds two new key-transfer code paths to review; every one is in scope of the
  pending cryptographic review.

## Exit criteria before this becomes code

1. The M3 review has returned findings on this document and on
   [`recovery-and-device-revocation.md`](../recovery-and-device-revocation.md).
2. Key-transfer and wrapping primitives exist in `@omnicloud/crypto` with
   negative test vectors: replay, wrong account, MITM transcript mismatch,
   expired/ single-use relay blob, and substitution of either public key.
3. Relay endpoints exist with TTL, per-user quotas, and abuse tests.
4. A second device obtains the URK **only** via an approved transfer, proven by
   a live test mirroring `docs/audits/live-e2ee-smoke.md`.
