# Known limitations

This page is the single list of what OmniCloud does not guarantee. Other pages
point here instead of repeating it. Each entry says what is true in this
release, and the limits are stated as limits rather than as caveats to be
looked past.

The security controls that _are_ in place are described in
[`security.md`](security.md).

## Contents

- [Encryption](#encryption)
- [Accounts, keys and recovery](#accounts-keys-and-recovery)
- [Telegram as the storage backend](#telegram-as-the-storage-backend)
- [Deployment scope](#deployment-scope)
- [Storage and transfers](#storage-and-transfers)
- [Consistency](#consistency)
- [Versions](#versions)
- [Authentication and sessions](#authentication-and-sessions)
- [The web application](#the-web-application)

## Encryption

- **Client-side end-to-end encryption is experimental and has not been
  independently reviewed.** The protocol is specified in
  [`security/encryption-protocol-v1.md`](security/encryption-protocol-v1.md) and
  implemented in `packages/crypto`. The review package is assembled and
  tracked in [`audits/encryption-review.md`](audits/encryption-review.md), but
  **no external cryptographic review has taken place**. Do not treat the
  implementation as audited or production-ready.
- **Encryption is opt-in and per file.** It is off until you generate a key and
  turn it on. Files uploaded before that stay plaintext until you migrate them
  (`omnicloud migrate <fileId|all>` in the CLI, or the per-file action in the
  web app). There is no silent fallback to an unencrypted upload: an encrypted
  upload is stored as ciphertext or the upload fails.
- **Encryption protects the contents, not the metadata.** File names, folder
  names, sizes, MIME types, timestamps and hashes stay visible to the server
  for OCE1 files, and the Telegram document still carries the real file name in
  its filename attribute.
- **The OCE2 "server-blind filename" format is implemented but not enabled by
  default**, and it is unreviewed. New uploads stay in OCE1 until the review
  covers the new format. The server checks that an OCE2 upload really carries
  an opaque name, so a client cannot claim OCE2 while sending a plaintext name.
- **The client artifact is trusted with your key.** The protocol assumes the
  web, SDK and CLI code that holds the root key is the code you intended to
  run. A compromised release, a compromised build pipeline or malware on the
  device defeat it.
- **Search does not reach into encrypted content.** The server searches
  metadata only; OCE2 files are answered from the client's own encrypted local
  index instead.

## Accounts, keys and recovery

- **Key recovery depends entirely on your recovery code.** A 256-bit recovery
  code derives a key that wraps your root key into an opaque blob. The server
  stores the blob and cannot open it. If you lose the recovery code, the file
  contents cannot be decrypted by anyone, including the maintainer.
- **A password reset cannot decrypt files.** Authentication and encryption-key
  recovery are separate. Restoring access to the account restores access to
  the drive's metadata — names, structure, versions — but it does not return
  the key that decrypts the contents.
- **Trusted-device enrollment is designed but not implemented.** The design is
  in
  [`security/architecture-decisions/0003-trusted-device-enrollment.md`](security/architecture-decisions/0003-trusted-device-enrollment.md).
  There is no code, no endpoint and no UI for enrolling a second device. Until
  it exists, a second device means a second key, and the recovery code is the
  only bridge between them.
- **There is no key escrow.** The server never holds a usable file key. That
  protects the contents from the operator and from a database compromise, and
  it also means there is no second copy to fall back on.
- **Losing the root key without the recovery code loses the contents.** The
  metadata survives; the bytes do not decrypt.

## Telegram as the storage backend

- **Telegram's own limits and availability apply to you.** Flood waits, rate
  limits, file-size rules, session invalidation and account restrictions are
  Telegram's, not OmniCloud's. A `429` from Telegram is surfaced as
  `RATE_LIMITED` with the delay Telegram reported.
- **One document is capped at 2 GB** by Telegram itself. OmniCloud's own cap
  is `MAX_UPLOAD_MB` (default 256), which is the lower of the two in practice.
- **The channel is the only copy of the bytes.** OmniCloud does not keep a
  second copy. Telegram's retention behaviour for the channel is outside this
  project's control, so back up anything you cannot lose.
- **Telegram can read the channel.** OmniCloud runs as _your_ Telegram
  account. Client-side encryption is what removes Telegram from the trust
  boundary for file contents.
- **Live Telegram behaviour is not verified in this release.** The download and
  upload paths are tested against fake GramJS clients. Real chunk behaviour,
  speed and Telegram's limits must be checked on a real account.

## Deployment scope

- **Single user per deployment.** One account drives one drive. There is no
  sharing, no public links and no multi-user collaboration, so there is no
  sharing-specific access model to reason about.
- **Single process.** One MTProto connection per user per process. Horizontal
  scaling is out of scope for this release.
- **Only the Telegram storage provider exists.** The storage layer is an
  abstraction, but no other provider is implemented or supported.
- **Search covers metadata only.** No content search, no full-text search, no
  indexing of file bodies.

## Storage and transfers

- **Uploads are spooled to disk, not held in memory.** The multipart body is
  written to a temporary directory while it is hashed, then handed to Telegram
  by path. Memory does not grow with file size: an 8 MB and a 64 MB upload add
  about the same live memory (measured with `measure:upload-memory`).
- **Downloads are streamed.** The final bytes are withheld until the SHA-256
  matches, so a corrupt object ends the response with a broken connection
  rather than completing with bad data.
- **Upload size is capped** by `MAX_UPLOAD_MB` (default 256). Telegram itself
  caps one document at 2 GB.
- **Temporary upload files are removed** on success, failure and rejection. A
  process killed mid-upload can leave one behind; the next start removes spools
  whose owning process is gone.
- **The client's encryption memory is bounded by a chunk, not by the file.** In
  the browser the chunk is 4 MiB and the ciphertext is spooled to OPFS when the
  browser provides it. The CLI and SDK stream to a spool file as well.

## Consistency

- **A lost Telegram response is never re-sent automatically.** A failure that
  may have stored the object is not retried by the storage engine: the
  operation is kept as `UNKNOWN`, and only a later request with the same
  operation id resolves it. That retry searches the channel for the caption
  `<SHA-256>:<operation id>` and the size. The operation id is unique per
  upload, so identical bytes uploaded twice never match each other. One match
  is adopted, no match is re-sent, and anything else stays `UNKNOWN` without a
  write. Uploads made before 0.2.28 carry no such caption, so they stay
  `UNKNOWN` for manual handling. The search itself has been checked once
  against a real channel; broader Telegram behaviour is still verified with
  fake clients only.
- **File and version metadata commit together.** A new file and its first
  version, and a replacement version and the file's pointer to it, are each
  written in one database transaction, so a failure cannot leave a file row
  without a version.
- **Telegram and PostgreSQL cannot share a transaction.** A failed commit after
  Telegram accepted an object removes that object. If that removal also fails,
  the leftover is recorded in the activity log with its message id, so it can be
  found and removed later; nothing is silently discarded.
- **A retry cannot commit the same upload twice.** Recovery of an `UNKNOWN`
  operation is guarded by a database claim, so only one request commits. A
  failure while marking an operation complete does not turn a committed upload
  back into a failure, and a retry returns the file that was already written.
- **Reconciliation reports, and repair is manual and explicit.** `POST
/api/storage/reconciliation` lists objects no record references (`unknown`)
  and records whose object is gone (`dangling`). `.../plan` proposes actions and
  `.../apply` performs only the ids you approve, after a fresh scan. No channel
  message is ever deleted: a dangling record is marked, and an unknown object is
  adopted. There is no scheduled scan and no automatic repair.
- **Reconciliation scans at most 5000 channel messages per request.** Larger
  channels are only partly covered.
- **Trash and restore are last-writer-wins** on a single field. Simultaneous
  trash and restore of one file can end in an unexpected final state. No
  storage object is lost by this.
- **Duplicate names are allowed** for files and folders.

## Versions

- **A version restore replaces the content in place; it does not create a new
  version.** The file is pointed back at the version that already exists. That
  is a requirement of the encryption format, not an optimisation: the OCE1
  record authentication binds the version id, so a copy of an old version's
  ciphertext under a new id would fail to authenticate and could never be
  decrypted. The consequence is that a restore does not grow the version
  history, and the file's own name is left alone.
- **The current version cannot be deleted.** The file would have nothing to
  point at, so the request is rejected with an explanation. Restore another
  version first, or delete the file.
- **Retention is an explicit operator action, not automatic.** `POST
/api/files/:id/versions/prune` removes historical versions under a policy you
  name (`KEEP_LATEST_N` or `KEEP_FOR_DAYS`). The default `KEEP_ALL` removes
  nothing. Nothing runs on a schedule, and the current version is never pruned.
- **Trashed data is purged on a schedule.** `TRASH_RETENTION_DAYS` (default 30,
  `0` keeps items indefinitely) bounds how long deleted data lingers. The purge
  is not a soft delete: after it runs, the bytes are gone.

## Authentication and sessions

- **Rate limiting is per process and in memory.** It resets on restart and is
  not shared between replicas. Behind a reverse proxy it is correct only when
  `TRUST_PROXY` is set correctly.
- **Telegram sessions are sealed with `OMNICLOUD_ENCRYPTION_KEY`.** Losing the
  key makes stored Telegram sessions unreadable; users then sign in again.
- **Logout does not end the Telegram session on Telegram's side.** Revoke that
  device in Telegram's settings.
- **The QR sign-in status route is polled by the browser**, so it carries a
  larger rate-limit budget than the sign-in endpoints. It is still origin
  checked, because it can issue a session cookie.

## The web application

- **A Content-Security-Policy is sent on served pages.** Inline scripts and
  styles are allowed by hash only; there is no `unsafe-inline` and no
  `unsafe-eval`. The API's JSON responses carry no policy, because they are
  not rendered as pages.
- **The browser's buffered-Blob fallback path is code-guarded but untested.**
  When a browser has no OPFS storage, the encrypted envelope accumulates as
  Blob parts and is capped at `BUFFERED_MAX_BYTES` (1 GiB) with an explicit
  error. The ceiling is enforced in code, but that path was never exercised at
  its boundary in a real browser, so the limit has not been measured.
- **The web benchmark was recorded in headless Firefox.** The streaming
  encryption evidence in
  [`evidence/web-streaming-bench.md`](evidence/web-streaming-bench.md) was
  produced in headless Firefox 158 via geckodriver on Linux, and it describes
  the OPFS path. Chromium was not available in that environment and
  Safari/WebKit was not tested, so the numbers do not describe those browsers.
  Browser heap could not be sampled at all: `performance.memory` is unavailable
  in Firefox, so the benchmark reports `-1` for peak heap rather than a
  fabricated figure.
- **The benchmark is a recorded local run, not a CI gate.** The CI runner has
  no browser and no geckodriver. The committed `packages/crypto` vector tests
  remain the automated guard for the crypto itself.
