# OCE2 — what a reviewer needs to know

**Status:** Implemented, tested and documented. **Not enabled by default and not
independently reviewed.** New uploads stay in OCE1 until the review in
[`encryption-review.md`](encryption-review.md) has returned findings on the new
format.

This note is the hand-off for that review. It says what was built, what was
deliberately left out, and where a reviewer should look hardest.

## What was built

| Piece                                   | Where                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| The normative format                    | [`../security/encryption-protocol-v2.md`](../security/encryption-protocol-v2.md)                                                                 |
| The design that led to it               | [`../security/architecture-decisions/0004-client-side-filename-index.md`](../security/architecture-decisions/0004-client-side-filename-index.md) |
| The index container and the opaque name | `packages/crypto/src/name-index.ts`                                                                                                              |
| The search evaluator                    | `packages/shared/src/search.ts`                                                                                                                  |
| Known-answer vectors                    | `packages/crypto/test/vectors/v1.json` (`index` section)                                                                                         |
| The server's rules                      | `packages/core/src/services/file-service.ts` (`commitRecord`), `apps/api/src/validation.ts`                                                      |
| The client's index and search           | `apps/web/src/lib/name-index-store.ts`, `apps/web/src/hooks/useNameIndex.ts`, `apps/web/src/components/SearchOverlay.tsx`                        |
| The migration                           | `apps/web/src/api/migration.ts` (`migrateToOpaqueName`)                                                                                          |

## The design decisions worth arguing with

1. **The opaque name carries no extension.** ADR 0004 proposed keeping it, on
   the grounds that dropping it would break downloads and previews. It does
   not: the client holds the real name and type in its index, and sets the
   type on the preview blob and the saved file itself. Keeping the extension
   would have told the server the file's type, which is the same leak in a
   smaller form. The spec takes the stronger position.

2. **The migration does not re-encrypt anything.** The same envelope bytes are
   uploaded again under the opaque name, so the envelope's own file and
   version ids — which the ciphertext is authenticated against — do not
   change, and the same metadata blob applies. The alternative, re-encrypting
   under a new version id, would have been a larger change to the envelope
   for no gain. A reviewer should check that the AAD binding really is
   unaffected by the server-side version id, since the two id spaces differ.

3. **The index holds the envelope's own ids, not the server's.** The metadata
   blob is authenticated against the envelope's ids, so a rename has to
   re-encrypt it under the same pair. Keeping them in the index is what makes
   a rename possible at all.

4. **`onDelete: NoAction` on the current-version foreign key.** So deleting a
   version a file points at is refused rather than silently clearing the
   pointer. This is the database agreeing with the application, not a new
   rule.

5. **The server refuses an OCE2 upload whose name is not opaque.** Without
   that check a client could claim the format and hand the server the real
   name, which would defeat the whole thing.

## What is deliberately not done

- **OCE2 is not enabled by default.** The format preference defaults to OCE1.
  The only way a user reaches an OCE2 file today is the explicit **Hide the
  name** action on an existing encrypted file; the preference itself has no
  user interface yet, so a new upload is always OCE1.
- **The index is not shared between devices.** Each client builds its own, by
  reading the server's listing and each file's metadata blob. A second device
  has to do that before it can search or show names.
- **Folder names are still visible to the server.** OCE2 covers file names.
- **A rename of an OCE1 file still does not update its metadata blob.** That
  is a pre-existing quirk, not an OCE2 one: the blob is bound to the
  envelope's ids, and an OCE1 client has no index entry recording them, so it
  cannot re-encrypt the metadata. The server endpoint that accepts a
  re-encrypted blob is in place for when that is addressed; the OCE2 path
  does use it.
- **The SDK and the CLI have no index.** Only the web client does. An OCE2
  file uploaded from the CLI would be listed under its placeholder by every
  client, because only the web client can read the name.

That last one is the most important thing a reviewer should weigh: **OCE2 as
implemented is a web-client feature.** Before it is enabled for anyone, the
SDK and the CLI need the same index, or a file uploaded anywhere but the web
is unreadable by name everywhere.

## The known-answer vectors

`packages/crypto/test/vectors/v1.json` now carries an `index` section with the
index key, the canonical JSON and the container, all under fixed inputs and a
fixed nonce. A second implementation can check it produces the same bytes.

`pnpm --filter @omnicloud/crypto run vectors:write` regenerates the file
deliberately. The test fails if the file is missing, so a broken
implementation cannot define its own baseline.

## How the review changes the plan

If the review finds a problem in the format, the fix is in
`packages/crypto/src/name-index.ts` and the vectors, and the clients follow.
If it finds a problem in the _design_ — the index being too much to protect,
the search being too limited, the migration being too clever — then the spec
changes first and the implementation follows. The OCE1 path is untouched
either way, so nothing that is already shipped depends on the outcome.
