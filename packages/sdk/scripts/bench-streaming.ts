/**
 * M5 streaming benchmark — measures throughput for the large-file E2EE paths
 * against a local HTTP server (no Telegram; this isolates the client crypto +
 * transfer path, which is what M5 changed).
 *
 * Runs:
 *   1. streaming upload (encrypt → spool → multipart) at BENCH_SIZE (default 1 GiB)
 *   2. streaming download (envelope → chunked decrypt → disk) of the same file
 *   3. in-memory upload (old path) at MEM_SIZE (default 256 MiB) for comparison
 *
 * This harness deliberately reports NO memory figures. The client, the test
 * server, and the generated fixtures share one process, so RSS here cannot be
 * attributed to the SDK — an earlier version of this script emitted
 * `peakRssMb` fields that looked like client measurements and were not. Client
 * memory is measured separately, with the client in its own process, by
 * `packages/sdk/test/streaming-memory.test.ts` (see
 * `docs/evidence/streaming-memory.md`).
 *
 * Usage:
 *   node apps/api/node_modules/tsx/dist/cli.mjs \
 *     packages/sdk/scripts/bench-streaming.ts
 *
 * Prints a JSON summary. Exit 0 = all runs completed and the round-trip
 * plaintext hash matched.
 */
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { OmniCloudClient, generateUrk } from "../src/index";
import { downloadDecryptedToFile, uploadEncrypted, uploadEncryptedStream } from "../src/encryption";

const STREAM_SIZE = Number(process.env.BENCH_SIZE ?? 1024 * 1024 * 1024);
const MEM_SIZE = Number(process.env.MEM_SIZE ?? 256 * 1024 * 1024);
const BLOCK = 8 * 1024 * 1024;

function patterned(size: number, seed = 7): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) out[i] = (i * 31 + seed) & 0xff;
  return out;
}

async function writePatterned(path: string, size: number): Promise<void> {
  const handle = await (await import("node:fs/promises")).open(path, "w");
  try {
    const block = new Uint8Array(BLOCK);
    let written = 0;
    let seed = 7;
    while (written < size) {
      const len = Math.min(BLOCK, size - written);
      for (let i = 0; i < len; i++) block[i] = (i * 31 + seed) & 0xff;
      await handle.write(block.subarray(0, len));
      written += len;
      seed = (seed + 13) & 0xff;
    }
  } finally {
    await handle.close();
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

interface ServerState {
  envelopePath: string;
  wrappedKey: string | null;
  metadataBlob: string | null;
  keyEpoch: string | null;
  receivedBytes: number;
}

async function startServer(
  envelopePath: string,
): Promise<{ url: string; state: ServerState; close: () => Promise<void> }> {
  const state: ServerState = {
    envelopePath,
    wrappedKey: null,
    metadataBlob: null,
    keyEpoch: null,
    receivedBytes: 0,
  };
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/files") {
      const contentType = req.headers["content-type"] ?? "";
      const boundary = /boundary=(\S+)/.exec(contentType)?.[1] ?? "";
      const tailLen = boundary.length + 8; // "\r\n--" + boundary + "--\r\n"
      const total = Number(req.headers["content-length"] ?? 0) || 0;
      const marker = "application/octet-stream\r\n\r\n";
      let head = Buffer.alloc(0);
      let out: ReturnType<typeof createWriteStream> | null = null;
      let written = 0;
      let envelopeLen = -1;

      req.on("data", (chunk: Buffer) => {
        state.receivedBytes += chunk.byteLength;
        if (out === null) {
          head = Buffer.concat([head, chunk]);
          const text = head.toString("latin1");
          state.wrappedKey ??= /name="wrappedKey"\r\n\r\n([^\r]+)/.exec(text)?.[1] ?? null;
          state.metadataBlob ??= /name="metadataBlob"\r\n\r\n([^\r]+)/.exec(text)?.[1] ?? null;
          state.keyEpoch ??= /name="keyEpoch"\r\n\r\n([^\r]+)/.exec(text)?.[1] ?? null;
          const idx = text.indexOf(marker);
          if (idx === -1) return;
          // The body is head (multipart fields + file-part header) + envelope
          // + tail; the envelope starts right after the marker.
          envelopeLen = Math.max(0, total - (idx + marker.length) - tailLen);
          out = createWriteStream(envelopePath);
          const initial = head.subarray(idx + marker.length, idx + marker.length + envelopeLen);
          written = initial.length;
          if (initial.length > 0 && !out.write(initial)) {
            req.pause();
            out.once("drain", () => req.resume());
          }
          return;
        }
        if (written >= envelopeLen) return; // trailing multipart boundary
        const toWrite = chunk.subarray(0, envelopeLen - written);
        written += toWrite.length;
        if (!out.write(toWrite)) {
          req.pause();
          out.once("drain", () => req.resume());
        }
      });
      req.on("end", () => {
        const respond = () => {
          console.error(
            `[bench-server] wrote=${written} envelopeLen=${envelopeLen} total=${total} tailLen=${tailLen} boundary=${boundary}`,
          );
          res.writeHead(201, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              file: {
                id: "bench",
                name: "bench.bin",
                size: envelopeLen,
                mimeType: "application/octet-stream",
                sha256: "0".repeat(64),
                folderId: null,
                starred: false,
                trashed: false,
                deletedAt: null,
                versionCount: 1,
                currentVersionId: "bench-v1",
                encryptionFormat: "OCE1",
                wrappedKey: state.wrappedKey,
                metadataBlob: state.metadataBlob,
                keyEpoch: Number(state.keyEpoch ?? "0"),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            }),
          );
        };
        if (out) out.end(respond);
        else respond();
      });
      return;
    }
    if (req.method === "GET" && req.url === "/api/files/bench") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          file: {
            id: "bench",
            name: "bench.bin",
            size: state.receivedBytes,
            mimeType: "application/octet-stream",
            sha256: "0".repeat(64),
            folderId: null,
            starred: false,
            trashed: false,
            deletedAt: null,
            versionCount: 1,
            currentVersionId: "bench-v1",
            encryptionFormat: "OCE1",
            wrappedKey: state.wrappedKey,
            metadataBlob: state.metadataBlob,
            keyEpoch: Number(state.keyEpoch ?? "0"),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }),
      );
      return;
    }
    if (req.method === "GET" && req.url === "/api/files/bench/download") {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      createReadStream(envelopePath).pipe(res);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "omnicloud-bench-"));
  const plainPath = join(dir, "plain.bin");
  const memPlainPath = join(dir, "plain-mem.bin");
  const envelopePath = join(dir, "server-envelope.bin");
  const outPath = join(dir, "decrypted.bin");
  const spoolDir = join(dir, "spool");

  console.error(`writing ${(STREAM_SIZE / (1024 * 1024)).toFixed(0)} MiB test file...`);
  await writePatterned(plainPath, STREAM_SIZE);
  await writePatterned(memPlainPath, MEM_SIZE);
  const plainSha = await sha256File(plainPath);

  const urk = generateUrk();
  const { url, close } = await startServer(envelopePath);
  const client = new OmniCloudClient({ baseUrl: url, token: "bench", retry: { attempts: 1 } });

  // Warm up the crypto JIT on a small buffer so the measured phases reflect
  // steady-state throughput, not first-call compilation.
  {
    const { encryptFile, decryptFile } = await import("@omnicloud/crypto");
    const warm = patterned(4 * 1024 * 1024);
    const enc = await encryptFile(warm, { urk, metadata: { name: "warm" } });
    await decryptFile({
      urk,
      fileId: enc.fileId,
      versionId: enc.versionId,
      keyEpoch: enc.keyEpoch,
      envelope: enc.envelope,
      wrappedKey: enc.wrappedKey,
      metadataBlob: enc.metadataBlob,
    });
  }

  const results: Record<string, unknown> = {
    streamUploadMiB: STREAM_SIZE / (1024 * 1024),
    memUploadMiB: MEM_SIZE / (1024 * 1024),
    node: process.version,
    note: "throughput only; client memory is measured in a separate process by test/streaming-memory.test.ts",
  };

  // ── 1. Streaming upload ──────────────────────────────────────────────────
  let t0 = performance.now();
  const up = await uploadEncryptedStream(client, plainPath, { name: "bench.bin", urk, spoolDir });
  const uploadMs = performance.now() - t0;
  results.streamingUpload = {
    ms: Math.round(uploadMs),
    mibPerSec: Math.round((STREAM_SIZE / (1024 * 1024) / (uploadMs / 1000)) * 10) / 10,
    fileId: up.fileId,
  };

  // ── 2. Streaming download + decrypt ──────────────────────────────────────
  t0 = performance.now();
  const down = await downloadDecryptedToFile(client, "bench", { urk, targetPath: outPath });
  const downloadMs = performance.now() - t0;
  const roundTripOk = down.sha256 === plainSha;
  results.streamingDownload = {
    ms: Math.round(downloadMs),
    mibPerSec: Math.round((STREAM_SIZE / (1024 * 1024) / (downloadMs / 1000)) * 10) / 10,
    roundTripOk,
    bytes: down.bytes,
  };

  // ── 3. In-memory upload (previous path) at the smaller size ──────────────
  const { readFile } = await import("node:fs/promises");
  t0 = performance.now();
  const memPlaintext = new Uint8Array(await readFile(memPlainPath));
  const memMid = performance.now();
  const memUp = await uploadEncrypted(
    client,
    { data: memPlaintext },
    { name: "bench-mem.bin", urk },
  );
  const memMs = performance.now() - t0;
  results.inMemoryUpload = {
    ms: Math.round(memMs),
    encryptMs: Math.round(memMid - t0),
    uploadMs: Math.round(memMs - (memMid - t0)),
    mibPerSec: Math.round((MEM_SIZE / (1024 * 1024) / (memMs / 1000)) * 10) / 10,
    fileId: memUp.fileId,
  };

  console.log(`M5 BENCH ${JSON.stringify(results)}`);
  await close();
  await rm(dir, { recursive: true, force: true });
  if (!roundTripOk) {
    console.error("round-trip hash mismatch");
    process.exit(1);
  }
}

main().catch(async (error) => {
  console.error("bench failed:", error);
  process.exit(1);
});
