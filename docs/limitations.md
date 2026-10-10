# Known limitations

This page is the single list of what OmniCloud does not guarantee. Other pages
point here instead of repeating it. Each entry says what is true today.

## Storage and transfers

- **Uploads are spooled to disk, not held in memory.** The multipart body is
  written to a temporary directory while it is hashed, then handed to Telegram
  by path. Memory does not grow with file size: an 8 MB and a 64 MB upload add
  about the same live memory (measured with `measure:upload-memory`).
- **Downloads are streamed.** The final bytes are withheld until the SHA-256
  matches, so a corrupt object ends the response with a broken connection.
- **Upload size is capped** by `MAX_UPLOAD_MB` (default 256). Telegram itself caps
  one document at 2 GB.
- **Temporary upload files are removed** on success, failure and rejection. A
  process killed mid-upload can leave one behind; the next start removes spools
  whose owning process is gone.
- **Live Telegram behaviour is not yet verified** in this release. The download
  and upload paths are tested against fake GramJS clients. Real chunk behaviour,
  speed and Telegram limits must be checked on a real account.

## Consistency

- **A lost Telegram response is resolved by search, not by re-sending.** The
  operation is kept as `UNKNOWN`. A retry with the same operation id searches the
  channel for the upload's SHA-256 caption and size. One match is adopted, no
  match is re-sent, and anything else stays `UNKNOWN` without a write. Uploads
  made before 0.2.27 carry no hash, so they stay `UNKNOWN` for manual handling.
  The search has been tested with fake clients only.
- **Telegram and PostgreSQL cannot share a transaction.** A failed commit after
  Telegram accepted an object removes that object. If that removal also fails, the
  object is left and is reported by reconciliation.
- **Reconciliation reports, and repair is manual and explicit.** `POST
/api/storage/reconciliation` lists objects no record references (`unknown`) and
  records whose object is gone (`dangling`). `.../plan` proposes actions and
  `.../apply` performs only the ids you approve, after a fresh scan. No channel
  message is ever deleted: a dangling record is marked, and an unknown object is
  adopted. There is no scheduled scan and no automatic repair.
- **Reconciliation scans at most 5000 channel messages per request.** Larger
  channels are only partly covered.
- **Trash and restore are last-writer-wins** on a single field. Simultaneous
  trash and restore of one file can end in an unexpected final state. No storage
  object is lost by this.
- **Duplicate names are allowed** for files and folders, as before.

## Versions

- **Version history is recorded, but there is no version-history UI** and no
  version restore or delete.
- **Retention is an explicit operator action, not automatic.** `POST
/api/files/:id/versions/prune` removes historical versions under a policy you name
  (`KEEP_LATEST_N` or `KEEP_FOR_DAYS`). The default `KEEP_ALL` removes nothing. Nothing
  runs on a schedule, and the current version is never pruned.

## Authentication and sessions

- **Rate limiting is per process and in memory.** It resets on restart and is not
  shared between replicas. Behind a reverse proxy it is correct only when
  `TRUST_PROXY` is set correctly.
- **Telegram sessions are sealed with `OMNICLOUD_ENCRYPTION_KEY`.** Losing the key
  makes stored Telegram sessions unreadable; users then sign in again.
- **Logout does not end the Telegram session on Telegram's side.** Revoke that
  device in Telegram's settings.

## Scope

- **Single process.** One MTProto connection per user per process. Horizontal
  scaling is out of scope for this release.
- **No end-to-end encryption.** Telegram can read channel content.
- **No sharing, public links, or multi-user collaboration.**
- **Search covers metadata only.** No content or full-text search.
- **Only the Telegram storage provider exists.**

## Web application

- **A Content-Security-Policy is sent on served pages.** Inline scripts and
  styles are allowed by hash only. The API's JSON responses carry no policy,
  because they are not rendered as pages.
