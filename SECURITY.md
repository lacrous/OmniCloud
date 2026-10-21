# Security policy

This document describes how to report a vulnerability in OmniCloud, what
happens after you report one, and what the project does and does not guarantee.

Two companion documents carry the detail:

- [`docs/security.md`](docs/security.md) is the operator-facing threat model and
  the list of controls.
- [`docs/limitations.md`](docs/limitations.md) is the single list of what this
  release does **not** guarantee. Check it before relying on any property.

> **Note:** **No independent cryptographic review of OmniCloud has taken
> place.** The client-side end-to-end encryption protocol is implemented and
> labelled experimental because it has not been reviewed by an independent
> cryptographer. The review package is assembled and tracked in
> [`docs/audits/encryption-review.md`](docs/audits/encryption-review.md); the
> review itself has not happened. No part of this project describes the
> protocol, the server or the release as audited, penetration-tested or
> certified.

## Supported versions

Security fixes land on the current minor release line. Older lines are not
patched.

| Version           | Supported | Notes                                                                                                 |
| ----------------- | --------- | ----------------------------------------------------------------------------------------------------- |
| 0.4.x             | Yes       | Current release. Version history, trash retention, streaming encryption, OCE2                         |
| 0.3.x             | No        | Upgrade to the latest 0.4.x release                                                                   |
| 0.2.x             | No        | Upgrade. The `@lacrous/omnicloud` package name is deprecated; the npm package is `@hilbras/omnicloud` |
| 0.1.x and earlier | No        | Upgrade                                                                                               |

The current release is published as `@hilbras/omnicloud` on npm. The older
`@lacrous/omnicloud` package is deprecated and stopped at 0.2.35.

> **Warning:** Only the latest release receives security fixes. If you are
> running an older line, upgrade before you report a problem — a report against
> an unsupported version may not be actionable.

## Reporting a vulnerability

**Report privately. Do not open a public issue, a discussion or a pull request
for a vulnerability.**

Use GitHub's private vulnerability reporting for this repository:

<https://github.com/Hilbras/OmniCloud/security/advisories/new>

If that route is unavailable to you, open a regular issue that contains no
technical detail — only a request to contact you privately — and wait for a
reply.

### What to include

| Item               | Why it helps                                                                    |
| ------------------ | ------------------------------------------------------------------------------- |
| Affected version   | The exact release, or the commit, that shows the problem                        |
| Affected component | API, web app, SDK/CLI, storage layer, or the encryption protocol                |
| Description        | What the issue is and what an attacker gains                                    |
| Reproduction steps | The smallest set of steps that shows it, including any request and response     |
| Proof of concept   | If you have one. A script is better than prose                                  |
| Impact             | Which accounts and which data are affected, and whether it needs a live account |
| Environment        | OmniCloud version, Node.js version, OS, and whether it runs behind a proxy      |

Please do not include real user data, real Telegram session strings, real
recovery codes or real root keys in a report. Use synthetic values.

### What not to do

- Do not test against someone else's account or channel.
- Do not exfiltrate, modify or delete data you did not create.
- Do not run automated scanners against a deployment you do not own.
- Do not disclose the issue publicly before a fix is released.

A report that stops short of these limits is still welcome, and the maintainer
will tell you what a responsible test looks like.

## Acknowledgement and response

| Stage             | Target                                                               |
| ----------------- | -------------------------------------------------------------------- |
| Acknowledgement   | Within 3 business days of the report                                 |
| Initial triage    | Within 7 days: reproduced, not reproduced, or needs more information |
| Severity assigned | At triage, using the classification below                            |
| Fix or mitigation | Aimed at the target below, or an agreed alternative                  |
| Release           | A patch release is published and the advisory is updated             |
| Public disclosure | After the fix ships, coordinated with the reporter                   |

| Severity | Fix target   |
| -------- | ------------ |
| Critical | 7 days       |
| High     | 14 days      |
| Medium   | 30 days      |
| Low      | Next release |

These are targets, not guarantees. The maintainer tells you if a target will
move and why. If a fix needs more design work than a patch release allows, the
mitigation or a configuration change is published first and the fix follows.

## Severity classification

Severity is judged by what an attacker gains, not by how the bug was found.

| Severity | Definition                                                                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Critical | Remote code execution in the server, unauthenticated access to file contents or to a Telegram session, or a full compromise of a deployment from an unauthenticated request. |
| High     | Authentication bypass, a broken ownership check that reaches another account's data, disclosure of file contents, or a denial of service that takes a deployment down.       |
| Medium   | A weakness that needs a precondition — a valid session, a known identifier, a social-engineering step — but still crosses a trust boundary or leaks metadata.                |
| Low      | Hardening gaps with limited impact: information disclosure of non-sensitive data, missing headers, or a weakness that only matters in combination with something else.       |

Findings about the experimental client-side encryption protocol are handled on
the same scale, but they are not treated as release blockers on their own: the
protocol is opt-in, off by default, and already labelled unreviewed. A
concrete break of a documented property — for example, ciphertext that
authenticates under the wrong key, or a nonce reused across envelopes — is
still treated as Critical or High.

## Disclosure coordination

- **The maintainer coordinates disclosure.** No advisory, issue or blog post
  about a vulnerability is published before a fix or mitigation is available.
- **The reporter is told before publication**, and is asked whether the report
  should be published as a GitHub advisory, as a release note, or kept
  internal.
- **The reporter is credited** in the advisory and the release notes by default.
  Say so in the report if you would rather not be named.
- **A CVE may be requested** for a Critical or High issue. The maintainer
  decides whether to request one, and shares the identifier with the reporter.
- **Disclosure is not blocked by a deadline.** If a fix is not ready, the
  maintainer says so and agrees a date with the reporter. If the reporter
  publishes first, the maintainer prioritises the fix and states the facts in
  the release notes.

## Operator guidance

These are the settings that matter most for a self-hosted deployment.

- Set `OMNICLOUD_ENCRYPTION_KEY` to a randomly generated 32-byte key
  (`openssl rand -hex 32`) and back it up separately from PostgreSQL. Losing it
  makes stored Telegram sessions unreadable. `SESSION_SECRET` is reserved and
  does not sign browser sessions.
- Serve over HTTPS and set `COOKIE_SECURE=true`. Behind a proxy also set
  `TRUST_PROXY=true` so client IPs — and therefore the authentication rate
  limiter — are read correctly.
- Set `ALLOWED_ORIGINS` if the web app is served from a different origin than
  the API.
- Back up PostgreSQL. It holds the only mapping between your drive and the
  Telegram messages, as well as the storage channel id and access hash.
- If you believe the server is compromised, revoke the session in Telegram
  (Settings → Devices). The stored string session becomes useless immediately.
- Turn on client-side encryption if a file's contents must survive the storage
  provider or a database compromise. It is opt-in and unreviewed; see
  [`docs/limitations.md`](docs/limitations.md).

Full details are in [`docs/security.md`](docs/security.md).

## What OmniCloud does not guarantee

The short list. The full list, with the reasoning behind each item, is in
[`docs/limitations.md`](docs/limitations.md).

- **File contents are readable by the server and by Telegram by default.**
  Client-side encryption is opt-in and unreviewed. Until you enable it and
  migrate your files, Telegram can read both the content and the file names.
- **File names are visible to the server even for encrypted files.** Only the
  experimental OCE2 format replaces a name with an opaque placeholder, and it
  is not enabled by default.
- **There is no sharing, public links or multi-user collaboration.** One
  deployment serves one account.
- **Rate limiting is in-memory and single-process**, and it is applied to the
  authentication endpoints only.
- **Key recovery depends on your recovery code.** A password reset restores
  account access, not the ability to decrypt files. Trusted-device enrollment
  is designed but not implemented.
- **Uploads are spooled to disk, not held in memory**, so an upload costs disk
  space proportional to its size rather than memory.

## Handling of secrets in this repository

No credentials are committed. `.env` is gitignored, `.env.example` documents
every variable with placeholder values, and the CI and release workflows read
the npm token from GitHub secrets rather than from the repository.
