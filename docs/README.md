# OmniCloud documentation

Everything about running, building and trusting OmniCloud. Start here, or jump
straight to the document you need.

## Suggested reading paths

**I want to run it.** [Quick start](../README.md#quick-start) in the
[README](../README.md#quick-start), then [Deployment](deployment.md) when you
put it on a server.

**I am writing an application against it.** The
[API reference](api.md) for the HTTP surface, the [SDK guide](sdk.md) for the
TypeScript client.

**I want to know what it protects.** [What the server and Telegram can
see](../README.md#what-the-server-can-see) in the README, then
[Security](security.md) and [Limitations](limitations.md). Read the limitations
before you rely on encryption.

**I want to understand the design.** [Architecture](architecture.md) for the
system, [Storage](storage.md) for the file lifecycle, and
[Storage provider](storage-provider.md) for the interface underneath.

**I found a problem.** [Troubleshooting](troubleshooting.md) first, then open
an issue.

## Using OmniCloud

| Document                                  | What it covers                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| [README](../README.md)                    | What OmniCloud is, quick start, configuration, feature overview                    |
| [API](api.md)                             | Every endpoint, parameter, response shape and error code                           |
| [SDK](sdk.md)                             | The TypeScript client, the streaming APIs, the encryption helpers and the CLI      |
| [Deployment](deployment.md)               | Production setup, Docker and systemd, reverse proxy, backups, upgrades, monitoring |
| [Troubleshooting](troubleshooting.md)     | Symptom-first fixes for the problems people actually hit                           |
| [Telegram](telegram.md)                   | The MTProto connection, sessions, rate limits, the storage channel                 |
| [Storage](storage.md)                     | Uploads, downloads, versions, trash retention, integrity and reconciliation        |
| [Storage provider](storage-provider.md)   | The `StorageProvider` interface, and how to implement another one                  |
| [Release checklist](release-checklist.md) | How a release is made and verified                                                 |

## How it works

| Document                            | What it covers                                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| [Architecture](architecture.md)     | The layering, the request lifecycle, the upload and download pipelines, transaction boundaries |
| [Execution plan](execution-plan.md) | What is planned, what is verified, and what is explicitly not done                             |

## Security

| Document                                                                     | What it covers                                             |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [Security](security.md)                                                      | The trust model, the controls, and what each one does      |
| [Limitations](limitations.md)                                                | What this release does **not** guarantee                   |
| [SECURITY.md](../SECURITY.md)                                                | How to report a vulnerability                              |
| [Threat model](security/threat-model.md)                                     | The threats the design addresses, and the ones it does not |
| [Current security baseline](security/current-security-baseline.md)           | Where plaintext, credentials and keys live today           |
| [Encryption requirements](security/encryption-requirements.md)               | What the encryption design has to satisfy                  |
| [Encryption protocol v1](security/encryption-protocol-v1.md)                 | The OCE1 envelope, chunking and key wrapping               |
| [Encryption protocol v2](security/encryption-protocol-v2.md)                 | The OCE2 format, which hides file names from the server    |
| [Recovery and device revocation](security/recovery-and-device-revocation.md) | Recovery codes, and the design for trusted devices         |
| [Legacy migration](security/legacy-migration.md)                             | Migrating plaintext uploads to encrypted ones              |
| [Architecture decisions](security/architecture-decisions/)                   | The records behind the decisions                           |

## Evidence

These are records of work that actually happened. They are dated, and they are
not rewritten when the code moves on.

| Document                                                             | What it covers                                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [Encryption readiness report](audits/encryption-readiness-report.md) | The repository audit that preceded the encryption work                          |
| [Encryption review](audits/encryption-review.md)                     | The cryptographic review package — **no independent reviewer has been engaged** |
| [Live E2EE smoke test](audits/live-e2ee-smoke.md)                    | An end-to-end run against a real Telegram account                               |
| [M2 migration smoke test](audits/m2-migration-smoke.md)              | The legacy migration, exercised                                                 |
| [M4 CLI smoke test](audits/m4-cli-smoke.md)                          | The CLI encryption commands, exercised                                          |
| [Deep-scan remediation](audits/deep-scan-remediation.md)             | The findings of a full repository scan, and what was done about each            |
| [Post-audit remediation](audits/post-audit-remediation-report.md)    | The fixes that followed that scan                                               |
| [Test evidence](audits/test-evidence.md)                             | Recorded test, bundle and coverage measurements                                 |
| [Known-answer vectors](audits/kat-vectors.md)                        | Test vectors for the encryption implementation                                  |
| [OCE2 review note](audits/oce2-review-note.md)                       | What still has to be reviewed before OCE2 is enabled                            |
| [Evidence directory](evidence/)                                      | Streaming and performance measurements                                          |

## Two things worth knowing before you start

- **End-to-end encryption is opt-in, experimental and unreviewed.** The
  [limitations](limitations.md) document says exactly what that means. Do not
  rely on it for anything you would not lose.
- **The server and Telegram can both read your files by default.** The
  [table in the README](../README.md#what-the-server-can-see) spells out what
  is visible in each mode.
