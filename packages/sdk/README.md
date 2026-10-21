# @hilbras/omnicloud

**A self-hosted cloud drive that keeps your files in your own Telegram account.**

[![npm](https://img.shields.io/npm/v/@hilbras/omnicloud)](https://www.npmjs.com/package/@hilbras/omnicloud)
[![license](https://img.shields.io/npm/l/@hilbras/omnicloud)](https://github.com/Hilbras/OmniCloud/blob/main/LICENSE)

This package ships three things:

- **`omnicloud`** — a command that applies the schema, starts the server and
  opens the web app.
- **An HTTP API** — the same server, on the same port as the web app.
- **A TypeScript SDK** — a typed client for that API, plus the client-side
  encryption helpers.

The bytes live in a private Telegram channel inside your own Telegram account.
PostgreSQL holds the logical filesystem. OmniCloud is the layer between them.

> Maintained by [Hilbras](https://github.com/Hilbras) · MIT licence ·
> [Source](https://github.com/Hilbras/OmniCloud) ·
> [Full documentation](https://github.com/Hilbras/OmniCloud#documentation)

---

## Install

```bash
npm install @hilbras/omnicloud
```

Node.js 20 or newer is required.

---

## Run the server

```bash
npx omnicloud
```

The first run asks for `DATABASE_URL`, `TELEGRAM_API_ID` and
`TELEGRAM_API_HASH`, generates `OMNICLOUD_ENCRYPTION_KEY`, applies the database
schema, starts the server and opens <http://localhost:4000>.

You need a PostgreSQL database and a Telegram API application — the latter takes
about two minutes at [my.telegram.org](https://my.telegram.org).

```bash
docker run -d --name omnicloud-postgres -p 127.0.0.1:5432:5432 \
  -e POSTGRES_USER=omnicloud -e POSTGRES_PASSWORD=omnicloud-dev-only -e POSTGRES_DB=omnicloud \
  postgres:16-alpine
```

On a server without a desktop, use `npx omnicloud start --no-open`.

---

## Use the SDK

```ts
import { OmniCloudClient } from "@hilbras/omnicloud";

const cloud = new OmniCloudClient({ baseUrl: "https://my-omnicloud.example" });

const file = await cloud.files.upload(
  { data: new Blob(["hello"]), name: "hello.txt" },
  { onProgress: (p) => console.log(`${p.percent}%`) },
);

await cloud.folders.create("Documents");
await cloud.files.star(file.id);
const found = await cloud.search.query("type:txt size:<1KB");
```

Node applications can stream a large download straight to disk with
`downloadToFile`, or iterate `downloadStream` without buffering it.

---

## Use the CLI

```bash
npx omnicloud login                       # store an API token, prompted for
npx omnicloud upload ./report.pdf --encrypt
npx omnicloud download <fileId> --decrypt -o ./report.pdf
npx omnicloud migrate all                 # encrypt legacy plaintext files
npx omnicloud versions <fileId> --restore <versionId>
```

Secrets are read from muted interactive prompts only. They are never accepted as
arguments, never written to the environment, and never printed.

---

## Client-side encryption

Files can be encrypted on your device before upload, with a per-file data key.
When it is on, the server and Telegram hold ciphertext only.

```ts
import { uploadEncrypted, downloadEncrypted } from "@hilbras/omnicloud";

// `urk` is your user root key: it wraps each file's data key.
const { fileId } = await uploadEncrypted(
  cloud,
  { data: new TextEncoder().encode("secret") },
  { name: "secret.txt", urk },
);

const { plaintext } = await downloadEncrypted(cloud, fileId, { urk });
```

In Node you can pass a path instead of the bytes:

```ts
await uploadEncrypted(cloud, { path: "./report.pdf" }, { name: "report.pdf", urk });
```

`downloadEncrypted` throws when the stored file is plaintext. It never falls
back to a plaintext download.

It is **opt-in and experimental**, and it has not been through an independent
cryptographic review. Plaintext files uploaded before you enabled it stay
plaintext until you migrate them. See
[the encryption review note](https://github.com/Hilbras/OmniCloud/blob/main/docs/audits/encryption-review.md)
and [the limitations](https://github.com/Hilbras/OmniCloud/blob/main/docs/limitations.md)
before relying on it.

---

## Documentation

| Document                                                                                  | Contents                                    |
| ----------------------------------------------------------------------------------------- | ------------------------------------------- |
| [API reference](https://github.com/Hilbras/OmniCloud/blob/main/docs/api.md)               | Every endpoint, parameter and error code    |
| [SDK reference](https://github.com/Hilbras/OmniCloud/blob/main/docs/sdk.md)               | The client, the streaming APIs and the CLI  |
| [Deployment](https://github.com/Hilbras/OmniCloud/blob/main/docs/deployment.md)           | Production setup, reverse proxy and backups |
| [Security](https://github.com/Hilbras/OmniCloud/blob/main/docs/security.md)               | The trust model and the controls around it  |
| [Troubleshooting](https://github.com/Hilbras/OmniCloud/blob/main/docs/troubleshooting.md) | Common problems and fixes                   |
| [Architecture](https://github.com/Hilbras/OmniCloud/blob/main/docs/architecture.md)       | How the pieces fit together                 |

---

## License

[MIT](https://github.com/Hilbras/OmniCloud/blob/main/LICENSE) © 2026 Hilbras
