# ADR 0004: Client-Side Filename Index and Client-Side Search

- **Status:** Accepted and specified. The normative format is
  [`encryption-protocol-v2.md`](../encryption-protocol-v2.md); this document is
  the design that led to it. **OCE2 has not been independently reviewed**, and
  it is not enabled by default: new uploads stay in OCE1 until the review in
  [`../../audits/encryption-review.md`](../../audits/encryption-review.md) has
  returned findings on it.
- **Date:** 2026-10-21
- **Related:** [`encryption-protocol-v1.md`](../encryption-protocol-v1.md),
  [`architecture-decisions/0003-trusted-device-enrollment.md`](0003-trusted-device-enrollment.md),
  [`../threat-model.md`](../threat-model.md)

## Context

OCE1 encrypts file _content_. It does not encrypt file _names_, and the
protocol document now says so plainly
([`encryption-protocol-v1.md` §5](../encryption-protocol-v1.md)):

- The API stores the plaintext name in `File.name` and the MIME type in
  `File.mimeType`, so the server can list and search.
- The Telegram document carries a filename attribute, taken from the upload's
  name (`CustomFile(input.name, …)` in `packages/telegram/src/provider.ts`).

So an operator reading the database, or anyone able to read the Telegram
channel, learns the names of every file — `tax-return-2026.pdf`,
`contract-final-v3.docx` — even though the contents are ciphertext. For a
product whose entire premise is that the storage backend cannot read your
files, that is the remaining gap, and it is the one that leaks the most about
what a user actually keeps.

The v1 protocol explicitly deferred this: _"Hiding the server-visible name
requires a follow-up design for client-side listing and search and is not
claimed by v1."_ This ADR is that follow-up design.

## Goals

- The API's database and the Telegram channel must not learn a file's name,
  MIME type, or description.
- Listing, browsing, and searching must still work, on the client.
- The change must be incremental: existing OCE1 files keep working and are not
  silently re-uploaded or re-encrypted.
- Every limit must be stated honestly, including the ones that make this
  design worse than server-side search for some users.

## Non-goals

- Encrypting the _existence_ of a file. The server still sees file ids, sizes,
  timestamps, folder membership, star flags, and counts. A design that hid
  those would need a different storage model, not a different index.
- Replacing the server's structured filters. The server keeps answering
  "files larger than 10 MB modified this month"; only the free-text and
  name-based parts move to the client.
- Sharing. Sharing an opaque-named file needs its own key-transfer design and
  is deliberately out of scope.

## Decision (proposed)

### 1. The server stores an opaque name

An OCE2 file's `File.name` is not the user's filename. It is a deterministic
but meaningless placeholder derived from the file id, for example
`f_01HZY8K3M4Q7.pdf` — the extension is kept so that some client-side and
operational affordances still work, and the stem carries no information.

The real name lives in the encrypted metadata blob, exactly as it already does
in OCE1. The change is that the _server-visible_ copy is replaced by the
placeholder, and the real name is only ever decrypted on a trusted client.

### 2. The Telegram document carries the same placeholder

The upload must not put the real name in the document's filename attribute
either, or the channel still leaks it. The client sends the placeholder as
the upload name. This is a one-line change in the provider, but it is the
change that actually closes the Telegram leak, and it must not be forgotten.

### 3. A client-side index holds the mapping

The client maintains an index from file id to the decrypted metadata it needs
to show and search: name, MIME type, description, size, and modification time.

- **Storage:** IndexedDB in the browser, and a local file for the CLI/SDK.
- **Protection:** the index is encrypted with a key derived from the URK, so a
  stolen browser profile or a copied disk yields ciphertext. The index is
  derived data — it can always be rebuilt from the server by downloading and
  decrypting each file's metadata blob — so losing it is an inconvenience, not
  data loss.
- **Rebuild:** on a new device the index is empty. The client walks the
  server's listing, downloads each file's (small) metadata blob, decrypts it,
  and populates the index. This is a metadata-only operation: it never
  downloads file content.

### 4. Search moves to the client

The client evaluates the query against the index and then applies the
server's structured filters to the resulting id set.

- The free-text part of the query (`report`, `type:pdf`, `name:contract`) is
  evaluated locally against the decrypted name, MIME type and description.
- The server is asked only for the id set that satisfies the filters the
  client cannot answer alone: size ranges, date ranges, folder membership,
  starred. Those are answered from data the server legitimately has.
- The result is the intersection, computed on the client.

The client then fetches the server's records for those ids to render size,
dates and actions. The server's `nameContains` filter is not used for OCE2
files, because it would only match placeholders.

### 5. The server's listing API is unchanged in shape

`GET /api/files` keeps returning the same DTO. For an OCE2 file, `name` is
the placeholder and `encryptionFormat` is `"OCE2"`. Clients that do not
understand OCE2 will show placeholders rather than real names — degraded, but
not broken, and never silently wrong.

## Consequences

**Better.** Neither the API's database nor the Telegram channel reveals a
filename. The content and the name are protected together, which is the
property a privacy-focused product is actually selling.

**Worse, and these must be said plainly:**

- **Search only works where the index exists.** A device that has never
  indexed the account cannot search it until it has. The CLI and the SDK would
  need to build an index too, or search would be web-only.
- **A fresh device must walk the whole account** to build its index. For a
  large account that is one metadata request per file. It is far cheaper than
  downloading content, but it is not free, and it is visible to the server as
  a burst of reads.
- **The index is a new thing to protect.** It is metadata about every file in
  one place. It is encrypted with a URK-derived key and can be rebuilt, but a
  compromised client that has decrypted it has leaked every name.
- **Size and timing still leak.** The size of a ciphertext is the size of the
  plaintext plus a small overhead, and a large upload is visible as a large
  upload. A filename index does not change that.
- **The extension survives.** Keeping the extension in the placeholder means
  the server still learns `pdf` or `mp4`. Dropping it too would break
  downloads and previews and is not proposed here.
- **Folder names are still visible.** The ADR covers file names. Folder names
  remain in the clear, because the folder tree is how the client navigates
  without an index. Folders would need their own treatment.

## Migration

1. **v1 stays readable.** A file uploaded as OCE1 keeps its plaintext name in
   `File.name` and remains fully functional. Nothing is re-encrypted.
2. **Opaque naming is opt-in per file, or per account.** A per-file switch
   keeps the migration incremental: a user can move one file at a time and
   watch what breaks. A per-account switch is simpler and should be the
   default once the index is reliable.
3. **Moving a file to OCE2 is a metadata operation, not a re-upload.** The
   content's ciphertext is unchanged; only the stored name, the document's
   filename attribute and the `encryptionFormat` change. The document filename
   attribute is the awkward part: Telegram does not let a document be renamed
   in place, so making an existing file opaque requires re-uploading its
   _ciphertext_ under the same content key, which is cheap (no re-encryption,
   the bytes and the DEK carry over) but is still a new object. That
   re-upload is exactly the kind of thing that must be verified before the old
   object is removed, following the same rule as the legacy migration
   (`docs/security/legacy-migration.md`).
4. **The index is rebuilt from scratch** on the first OCE2 client, from the
   metadata blobs, which the server can already serve.

## What must be true before any of this is implemented

- [ ] The protocol change is written up as OCE2 in
      `docs/security/encryption-protocol-v1.md` (or a successor) with its own
      test vectors, and the cross-client vector set is extended.
- [ ] The placeholder format is specified precisely enough that two clients
      derive the same placeholder for the same file id.
- [ ] The index format, its encryption, and its rebuild procedure are
      specified, including what happens when the index and the server
      disagree.
- [ ] The client's search evaluation is specified precisely enough that
      Web, CLI and Android can agree on the result set.
- [ ] The independent review of `docs/audits/encryption-review.md` has
      returned findings on this design, and the high-severity ones are fixed.
- [ ] The "not independently reviewed" wording stays closed until that review
      completes, for this design as for the rest of the protocol.

## Alternatives considered

- **Encrypt the name in place and let the server search ciphertext.** Rejected:
  it needs a searchable encryption scheme, which is a research project with
  its own leakage profile, and it is a much larger change than an index.
- **Keep plaintext names and accept the leak.** Rejected: it is what v1
  already does, and the point of the follow-up was to close it.
- **Obfuscate names on the server with a per-user key.** Rejected: the server
  would then hold a key that can decrypt the names, which is a weaker version
  of the problem rather than a solution.
- **Put the index in a server-side table, encrypted.** Rejected: it moves the
  leak rather than closing it, and it centralises the metadata the design is
  trying to distribute.
