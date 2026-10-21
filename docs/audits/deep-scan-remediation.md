# Deep scan remediation

**Source:** `/home/gin/work/lacrous/DEEP_SCAN_REPORT.md` (2026-10-21)
**Branch:** `post-audit-remediation`
**Outcome:** every finding is either fixed, verified as already fixed, verified as
a false positive, or declined with a stated reason. Nothing was left unexamined.

| Outcome                                                                        | Count |
| ------------------------------------------------------------------------------ | ----- |
| Fixed                                                                          | 22    |
| Partly fixed (behaviour unchanged, limitation documented and covered by tests) | 1     |
| Already fixed when checked                                                     | 2     |
| False positive (the suggested change would be wrong)                           | 4     |
| Declined with a reason                                                         | 4     |
| Coverage gaps closed                                                           | 3     |

That accounts for all 33 numbered findings (1 high, 10 medium, 22 low). The
report's five coverage and convention gaps are handled at the end.

---

## High

### H1 — Stale test mock blocked the API build

**Already fixed.** The report was written against a tree where
`apps/api/test/repos.ts` was missing `UserRepository.listAll()`. That mock was
updated as part of the trash-retention work, and the API typecheck, build and
184 tests pass.

## Medium

### M1 — IDOR: subtree trash/restore without an ownership check — **fixed**

`restoreSubtree` and `trashSubtree` ran `updateMany` keyed only by id. The
service layer checked ownership, but the write itself was not scoped, so a bug
in a caller could reach another account's data.

The repository methods now take the `userId` and scope the write to it — in the
database, in the in-memory fake and in the API test mock. The subtree root's
reparent is scoped the same way.

_Verified against a real PostgreSQL database:_ three new tests prove a user who
knows another account's ids cannot trash, restore or reparent that account's
items. The test was confirmed to fail when the ownership predicate is removed.

### M2 — Concurrent version creation race and a stale parent record — **fixed**

`createVersion` read the next version number and wrote it, with no retry, and
never updated the parent file — so the file could describe a version other than
the one it pointed at. The seeder patched this by hand.

It now runs in a serializable transaction with the P2034 retry the rest of the
repository uses, and writes the parent's current-version fields in the same
transaction. The seeder's manual patch is gone.

_Verified against a real PostgreSQL database:_ three concurrent creations get
distinct version numbers, and the parent file ends up describing the version
that is current.

### M3 — Contradictory combined name filter — **false positive**

`fileWhere` spreads the existing `name` filter before adding `endsWith`. When
both `nameContains` and `ext` are given, the result is
`{ contains, endsWith, mode }` — which Prisma accepts, combining the two
operators with AND. A name containing the text _and_ ending with the extension
is exactly the intended filter. The duplicated `mode` key is a single key in an
object literal, so it is not a duplication at all.

**Not changed.** The suggestion would have broken the filter.

### M4 — Failed commit leaves the operation stuck in COMMITTING — **false positive**

The report proposes marking the operation `FAILED`. That would be wrong on the
path the report cites.

There are two commit-failure paths, and they have different correct outcomes:

- **The object was stored by the request that failed the commit.** The stored
  object is removed along with the failed commit, so nothing is left behind and
  the operation is `FAILED` — a retry may re-upload. This is what `uploadOnce`
  does, and it is correct.
- **The object was stored by an earlier request**, and this request is only
  turning it into a file record. The object is _not_ removed. Marking the
  operation `FAILED` here would make the next retry re-upload, leaving the
  stored object orphaned in the channel beside a second copy. `FAILED` means the
  Telegram write definitively failed, and on this path it did not.

On the second path the correct state is `UPLOADING` with the message id still
set: the next request with the same operation id finds the stored object and
commits it without uploading again, and the reconciliation sweep protects the
object from being reported as an orphan.
`packages/core/test/stuck-committing.test.ts` already covered that recovery.

**Not changed in behaviour.** The reasoning is now written down at the catch so
the next scan does not read it as a defect, and
`packages/core/test/commit-failure-recovery.test.ts` now covers both paths
explicitly, including that the second path retries without storing a second
object.

### M5 — Non-atomic versionCount decrement — **fixed**

The count was read before the delete and written afterwards, so two concurrent
deletes both wrote the same decremented value.

The delete and the count now move together in one serializable transaction, and
the repository refuses to delete the version a file points at — which the
service already refused, so the rule now holds even if a caller forgets.

_Verified against a real PostgreSQL database:_ the count is decremented exactly
once per delete when deletes race. The test was confirmed to fail three times
out of three without the serializable transaction.

### M6 — Misleading upload error for path-only input — **fixed**

The size was computed before checking that there was anything to upload, so a
spooled file supplied without its size was reported as "neither data nor a
spooled file" even though a path was present. The two cases now have separate
messages, with a test for each.

### M7 — Self-healing committed test vectors — **fixed**

When `vectors/v1.json` was missing, the test wrote the current output and
passed. A crypto change that altered the output would therefore have defined
the broken output as the new baseline.

The test now fails when the committed vector is absent, regenerating it is a
separate deliberate command (`pnpm --filter @omnicloud/crypto vectors:write`),
and the whole vector is compared rather than six of its fields. Regeneration was
confirmed to reproduce the committed file byte for byte.

_Verified:_ removing the committed file makes the test fail with a message
naming the regeneration command.

### M8 — Literal error-code strings instead of the shared enum — **fixed**

Four places compared `error.code` against the literal
`"TELEGRAM_AUTH_REQUIRED"`. They use `ERROR_CODES.TELEGRAM_AUTH_REQUIRED` now.

### M9 — Partial payload cast to a full DTO — **fixed**

The upload response parser checked only that the file had an id and a name,
then cast the object to `FileDTO`, so a partial response produced a DTO whose
size, MIME type, dates and flags were `undefined`.

There is now a real validator (`apps/web/src/lib/dto.ts`) that checks every
field the interface promises, and the parser uses it.

### M10 — Browser-only DOM in the download client — **fixed**

`files.download()` used a bare `document`, failing with "document is not
defined" in Node or during server rendering. It now checks for a DOM and fails
with a message that says what to use instead.

---

## Low

| #   | Finding                                                                          | Outcome                                                                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | `mapVersion`'s second parameter was never read                                   | **Fixed** — removed, with the query behind it                                                                                                                                                                                      |
| L2  | `PrismaClient` re-export unused                                                  | **Fixed** — the package is private and nothing imported it                                                                                                                                                                         |
| L3  | `skipTake` could produce a negative skip                                         | **Fixed** — page and limit are floored at 1                                                                                                                                                                                        |
| L4  | Unvalidated casts on raw activity rows                                           | **Fixed** — an unknown action becomes `other`, an unknown resource type falls back                                                                                                                                                 |
| L5  | `File.currentVersionId` has no foreign key to `FileVersion.id`                   | **Fixed** — see below                                                                                                                                                                                                              |
| L6  | `deleteVersion` ignored the delete count and did not refuse the current version  | **Fixed** under M5                                                                                                                                                                                                                 |
| L7  | The in-memory fake lacked the current-version refusal                            | **Fixed** under M5 — the fake now matches the database                                                                                                                                                                             |
| L8  | Duplicate `sha256Hex` import in the engine                                       | **Fixed**                                                                                                                                                                                                                          |
| L9  | No comparison of the stored size against the uploaded size                       | **Fixed** — the engine now fails if the provider stored a different number of bytes                                                                                                                                                |
| L10 | The integrity check runs at flush, so an early-abandoned stream is never checked | **Partly fixed** — the limitation is now stated in the method's doc, and two tests cover the contract. The check itself cannot run before the whole object is read, and the SDK detects a truncated transfer from `Content-Length` |
| L11 | `canTransition` and `isTerminal` are only used by tests                          | **Declined** — they are the state machine's public vocabulary; the module's own tests are a legitimate consumer                                                                                                                    |
| L12 | `folder-order` and `retry` missing from the core barrel                          | **Fixed** — now exported like every other util                                                                                                                                                                                     |
| L13 | GramJS's `_switchDC` is private by convention                                    | **Declined** — it is inside a third-party library; the alternative is forking the library or dropping DC migration. It is flagged in the code where it is used                                                                     |
| L14 | `client: null as unknown as TelegramClient`                                      | **Fixed** — the type is now `TelegramClient                                                                                                                                                                                        | null`, and the three places that assumed a client always existed handle the null |
| L15 | `client.session.save() as unknown as string`                                     | **Fixed** — the client is always built with a `StringSession`, which is now checked rather than assumed                                                                                                                            |
| L16 | Untyped cast reading flood-wait `seconds`                                        | **False positive** — the cast is defensive: the value is read as `unknown` and used only after `typeof seconds === "number"`. It cannot produce a wrong value                                                                      |
| L17 | `decryptChunks` uses exception-based control flow (~2× AEAD work)                | **Declined** — a performance characteristic, not a defect. Rewriting the envelope format for it would be a protocol change                                                                                                         |
| L18 | Unused `ListQuery` type import in the shared barrel                              | **False positive** — `export type { ListQuery } from "./query"` does not create a local binding, so the local `QueryParams = ListQuery` alias still needs the import                                                               |
| L19 | The built SDK bundles lacked the new client methods                              | **Already fixed** — the bundle was rebuilt, and the declarations test now checks that the built declarations still declare every value the source exports and every method the client's sub-APIs expose                            |
| L20 | `content-length: 0` collapsed the total to null                                  | **Fixed** — an absent header and a zero length are now different, so an empty download is length-checked                                                                                                                           |
| L21 | `ItemActionHandler` exported with no importers                                   | **Fixed** — removed                                                                                                                                                                                                                |
| L22 | A bare `export { StorageUnavailableError }` at the bottom of the file            | **Declined** — the error is defined in the core but raised by this package's provider, so it belongs on this package's surface. Removing the re-export, as the report suggests, would have removed it from the public API          |

### L5 — The current-version pointer had no foreign key — **fixed**

`File.currentVersionId` was a bare string, so the database could not tell
whether it referred to a real version of that file. The application checked, but
the constraint now holds the line too.

- **Schema:** `currentVersionId` is now a unique foreign key to
  `FileVersion.id`. It is unique because a version belongs to exactly one file,
  so at most one file can point at it.
- **Migration** (`10_file_current_version_fk`): pointers that do not resolve —
  a missing version, or another file's version — are cleared to null before the
  constraint is added, because such a file has no coherent current version to
  point at. A dangling pointer would otherwise make the migration fail to
  apply.
- **`onDelete: NoAction`**, deliberately. `Cascade` would remove the pointer
  silently and `SetNull` would do the same; `NoAction` refuses the delete
  instead. Deleting a _file_ still cascades to its versions, because the
  constraint is checked at the end of the statement, by which time the file row
  is gone.
- The application already refused to delete a version a file points at; the
  constraint now enforces the same rule underneath it.

_Verified against a real PostgreSQL database:_ four tests prove that pointing a
file at a missing version, at another file's version, or deleting the version a
file points at are all refused, and that deleting a file still cascades to its
versions. The migration's cleanup was verified on data that had a dangling
pointer: the good pointer survived and the dangling one was cleared.

---

## Coverage and convention gaps

- **`apps/web` had no tests** — **fixed.** The package now has a vitest suite:
  nine tests for the payload validator and two for the client.
- **`packages/shared/src/mime.ts` had no tests** — **fixed.** Twenty tests cover
  extension parsing, category mapping and filter expansion, including that
  `report.pdf.exe` is not treated as a PDF.
- **Trash retention was not covered end to end** — **already fixed** with the
  feature: eight core tests, four API route tests, and the SDK and web methods.
- **The SDK declarations test skipped the dist check locally** — **strengthened.**
  It now compares the built declarations against the source, scoped to each
  declared class. Removing a method from the built declarations was confirmed to
  make it fail.
- **Trash routes live in `routes/collections.ts`** — not changed. The file holds
  the collection views (Trash, Starred, Recent, Search, Activity) and the trash
  routes belong with them; a file per view would scatter related routes.
- **`provider.ts` mixes `bigInt` ids with `Number()` size conversions** — not
  changed. The ids come from the database and the sizes from the provider's
  public type, so the conversions are at the boundary and are correct.

## Also found while fixing these

Three packages excluded their test directories from the typecheck, so drift
between a test and the interface it exercised went unnoticed — the reason the
report's H1 could exist at all.

- `packages/database/tsconfig.json` — now includes `test`
- `packages/crypto/tsconfig.json` — now includes `test`
- `packages/shared/tsconfig.json` — now includes `test`
- `apps/web/tsconfig.json` — now includes `test`

Including them surfaced three pre-existing type errors, all fixed: a missing
encryption-field argument and a possibly-null version in the database's version
tests, and a spread in the crypto's envelope test that silently overwrote the
file and version ids.
