# OmniCloud E2EE Protocol v2 (OCE2) — Server-Blind Filenames

**Status:** Proposed. Normative for the OCE2 format. Independent cryptographic
review is required before OCE2 is enabled for anyone; OCE1 remains the shipped
format until then. This document refines
[`architecture-decisions/0004-client-side-filename-index.md`](architecture-decisions/0004-client-side-filename-index.md)
and does not contradict it.

**Related:** [`encryption-protocol-v1.md`](encryption-protocol-v1.md),
[`recovery-and-device-revocation.md`](recovery-and-device-revocation.md),
[`../threat-model.md`](threat-model.md)

---

## 1. What changes

OCE1 encrypts a file's **contents** and its **metadata blob**, but the
plaintext name is still sent to the server as the multipart filename and stored
in `File.name`, and the Telegram document carries it as a filename attribute.
The server therefore learns every file's name.

OCE2 removes that. The server stores an **opaque name** it cannot relate to the
real one, and the real name lives only in a **client-side index** that the
client encrypts with a key derived from the user's root key.

|                               | OCE1                      | OCE2                                       |
| ----------------------------- | ------------------------- | ------------------------------------------ |
| File contents                 | encrypted                 | encrypted                                  |
| Real file name                | **visible to the server** | encrypted, client-side only                |
| File type                     | **visible to the server** | not visible (derived from the opaque name) |
| Server-side name search       | works                     | does not work; the client searches         |
| Telegram document filename    | real name                 | opaque name                                |
| Folder names                  | visible                   | visible (unchanged in v2)                  |
| Size, timestamps, ids, counts | visible                   | visible (unchanged)                        |

## 2. Requirements

1. A client's **root key (URK) is the only secret** required. The index is
   derived from it; no new key material is generated or stored.
2. The index is **derived data**: it can always be rebuilt from the server by
   re-reading each file's metadata blob. Losing it is an inconvenience, not
   data loss.
3. The server **MUST NOT** be able to derive a real name from an opaque name.
4. The opaque name **MUST NOT** be derivable from the real name, so that two
   uploads of the same file do not produce the same placeholder.
5. A client **MUST** be able to tell an OCE2 file from an OCE1 file, and
   **MUST** handle an account that contains both.
6. OCE1 behaviour **MUST NOT** change. A file uploaded as OCE1 keeps its
   plaintext name and remains searchable server-side.

## 3. The opaque name

### 3.1 Format

```
opaqueName = "om_" + hex(16 random bytes)
```

- 16 random bytes from the platform CSPRNG, lowercase hex, no separators.
- 35 characters total.
- The client generates a **fresh** opaque name for every upload and every
  replacement. Two versions of the same file therefore have unrelated
  placeholders, and two uploads of the same bytes are unrelated too.

### 3.2 Why it carries no extension

The name is **not** given an extension. An extension would tell the server the
file's type, which is the same leak in a smaller form, and it is not needed:
the client holds the real name and type in its index, and previews and downloads
use those.

This is stronger than the sketch in ADR 0004, which proposed keeping the
extension. The extension survives only in the client's index, never at the
server. The consequence — the server stores `application/octet-stream` for
OCE2 files — is listed in §8.

### 3.3 The server-visible MIME type

The server derives the MIME type from the filename it was given. For an OCE2
upload that filename is the opaque name, which has no extension, so the derived
type is `application/octet-stream`. The server does not learn the real type.

The client sets the correct type where it matters: the preview blob is created
with the type from the index, and a download is saved under the real name.

## 4. The client-side index

### 4.1 What an entry holds

One entry per file the client knows about:

```json
{
  "id": "cuid_...",
  "name": "report.pdf",
  "mimeType": "application/pdf",
  "description": "Q3 numbers",
  "size": 2097152,
  "folderId": "cuid_...",
  "starred": false,
  "trashed": false,
  "versionCount": 2,
  "createdAt": "2026-10-01T00:00:00.000Z",
  "updatedAt": "2026-10-02T00:00:00.000Z",
  "cryptoFileId": "hex…",
  "cryptoVersionId": "hex…"
}
```

`id`, `size`, `folderId`, `starred`, `trashed`, `versionCount` and the
timestamps come from the server's listing; `name`, `mimeType` and `description`
come from the file's encrypted metadata blob. Together they are enough to
answer every query the server could answer, locally.

`cryptoFileId` and `cryptoVersionId` are the ids the envelope's own header
carries, not the server's. The metadata blob is authenticated against them, so a
rename has to re-encrypt the metadata under the same pair; keeping them in the
entry is what makes that possible. They are omitted when the client does not
know them, in which case the file's name cannot be changed.

### 4.2 The container

```
indexKey  = HKDF-SHA256(ikm = URK, salt = "omnicloud-e2ee-v2",
                        info = "omnicloud/e2ee/v2/index", length = 32)
aad       = "OCE2" || 0x02 || 0x01 || u32be(keyEpoch) || 0x06
container = nonce(24) || XChaCha20-Poly1305(indexKey, nonce, plaintext, aad)
```

- `"OCE2"` is the four bytes `4f 43 45 32`; `0x02` is the container format
  version; `0x01` is the suite (XChaCha20-Poly1305); `u32be(keyEpoch)` is the
  key epoch as a big-endian 32-bit integer; `0x06` is the AAD type byte for an
  index container.
- `plaintext` is the UTF-8 encoding of the canonical JSON described in §4.3.
- The nonce is random per write. A nonce is never reused with the same key.

### 4.3 Canonical JSON

The plaintext is a JSON object with exactly one key, `entries`, whose value is
an array of the entries in §4.1. Serialisation is canonical:

- Object keys within an entry are in lexicographic order.
- No insignificant whitespace.
- Strings use JSON escaping with no non-ASCII escaping.
- Numbers are integers.
- `null` for absent optional fields; absent optional fields are **omitted**
  rather than written as null, except `folderId` and `description`, which are
  always present (null when empty).

Two clients that hold the same index must produce the same bytes.

### 4.4 Storage

- **Browser:** IndexedDB, one object store `index`, one record per account,
  holding the container bytes.
- **CLI and SDK:** a local file, written `0600`, holding the container bytes.

The container is opaque on disk: it is the encrypted form, so the file reveals
nothing without the URK.

### 4.5 Rebuilding

An empty or missing index is rebuilt by walking the server's listing, reading
each OCE2 file's metadata blob, decrypting it, and writing the entries. The
rebuild is a metadata-only operation — it never downloads file contents.

## 5. Searching

### 5.1 What the client does

1. Parse the query with the shared parser (`parseSearchQuery`), producing a
   `ListQuery` and a free-text term.
2. Evaluate the `ListQuery` against the index entries with the shared
   evaluator (`matchesListQuery`).
3. Filter by the free-text term against the entry's name.
4. Fetch the matching file records from the server for size, dates and actions.

The evaluator is shared with the server so that a query means the same thing
in both places.

### 5.2 Mixed accounts

An account may hold OCE1 and OCE2 files. The client:

- Sends the query to the server and keeps the OCE1 results, which the server
  can match by name.
- Evaluates the same query against its index and adds the OCE2 results.
- Merges the two sets by file id and sorts once, by the requested field.

A file appears once, whichever path found it.

### 5.3 What the client cannot answer

Nothing in the query grammar needs the server. The evaluator covers name
substring, type, extension, size bounds, date bounds, folder, starred and
status, using only index data.

## 6. Migration from OCE1

A file moves from OCE1 to OCE2 by being uploaded again under an opaque name.
The **content is not re-encrypted**: the same envelope bytes are uploaded
again, so the envelope's own file and version ids — which the ciphertext is
authenticated against — do not change, and the same wrapped key and metadata
blob apply. The real name therefore travels in exactly one encrypted place, as
it did before.

What changes is the name the server stores, from the real one to an opaque
placeholder, and the format recorded against the version.

The sequence, following the verify-before-delete rule the legacy migration
already uses:

1. Download the current version's envelope and decrypt it, which yields the
   plaintext to compare against and the real name to keep.
2. Upload the same envelope bytes under a new opaque name, with the format
   recorded as OCE2.
3. Download it back, decrypt it, and compare the plaintext byte for byte with
   the original.
4. Only then remove the old version's object and record.
5. Update the index: the entry's name, MIME type and description now come from
   the OCE2 metadata blob, and the entry records the envelope's own file and
   version ids so that a later rename can re-encrypt the metadata.

If step 3 fails, the old version is left in place and the file stays OCE1. The
migration is therefore safe to retry and never risks the content.

## 7. What remains visible

OCE2 does **not** hide:

- The number of files, their sizes, their timestamps, and their folder
  membership.
- Folder names.
- The account's total storage and the pattern of its activity.
- Which files are starred or trashed.

A server that watches traffic can still infer a great deal. OCE2 makes the
**names** private; it does not make the account private.

## 8. Known limitations

- **Search needs the index.** A device that has not built its index cannot
  search the account's OCE2 files. A rebuild reads one metadata blob per file,
  which is visible to the server as a burst of reads.
- **The index is a new thing to protect.** It holds every name in one place.
  It is encrypted with a URK-derived key and can be rebuilt, but a client that
  has decrypted it has, by definition, the names.
- **The client keeps the names in memory** while it is running. JavaScript
  cannot guarantee zeroization; this is the same limitation the rest of the
  protocol has.
- **The server still sees the folder tree and the file sizes.**
- **A lost URK means lost names**, and with them lost OCE2 files, exactly as
  with OCE1 contents. The recovery container covers the URK; the index is
  rebuilt from it.
- **No OCE2 yet.** This document specifies a format that has not been
  implemented, and the implementation that follows has not been reviewed.

## 9. Test vectors and interoperability

- The container is covered by a known-answer vector in
  `packages/crypto/test/vectors/v1.json`, so a second implementation can check
  it produces the same bytes.
- The opaque name format is checked by a vector for its derivation from fixed
  random bytes.
- The canonical JSON form is checked by a vector, so two implementations
  serialise the same index the same way.
- A tampered container must fail to open; a container opened under the wrong
  URK must fail to open.

## 10. Review gates

OCE2 must not be enabled for anyone until:

- [ ] The independent review of [`../audits/encryption-review.md`](../audits/encryption-review.md)
      has returned findings on this document and on the OCE1 protocol it
      extends.
- [ ] The canonical JSON rules are implemented identically by the web client
      and the SDK, with a shared test vector proving it.
- [ ] The migration has been tested against a real Telegram channel, with the
      verify-before-delete ordering proven by the failure case.
- [ ] The wording gate on "independently reviewed" remains closed until that
      review completes.
