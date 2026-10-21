<!--
Keep this template short. A reviewer needs to know what changed, why, and how
you know it works — everything else they can read in the diff.
-->

## What does this change?

<!-- One or two sentences. What is different after this pull request? -->

## Why?

<!-- The problem being solved, or the bug being fixed. Link the issue if there is one: Fixes #123 -->

## How was it tested?

<!--
What you ran, and what you saw. If the change touches encryption, key
management or the storage layer, say which test covers it — for example a
round trip, a migration run, or an interoperability check against another
client.
-->

## Checklist

- [ ] `pnpm format:check` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes
- [ ] `pnpm test` passes
- [ ] New behaviour is covered by a test, and a bug fix comes with a test that fails without the fix

## Security and privacy

- [ ] No plaintext encryption key, recovery code, token, session cookie or personal file name is added to the code, the tests or the logs
- [ ] The server still never receives the plaintext file-encryption keys
- [ ] The change does not silently fall back from encrypted storage to plaintext
- [ ] Any new metadata the server can now see is documented in `docs/security.md`

## Notes for the reviewer

<!-- Anything worth flagging: a risky area, a decision you were unsure about, or follow-up work you did not include. -->
