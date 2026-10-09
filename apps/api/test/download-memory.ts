/**
 * Measures server-side memory during downloads, end to end over a real socket.
 *
 *   pnpm --filter @omnicloud/api measure:download-memory
 *
 * The provider generates the object on demand in fixed-size chunks and never
 * holds it, so the measured memory is the server's: the streamed response and
 * the integrity gate. The stored SHA-256 is computed from the same generator, so
 * a correct download completes; any memory growth is the server's own.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { createTestHarness } from "./harness";
import { FakeStorageProvider } from "./repos";

const MB = 1024 * 1024;
const CHUNK = 512 * 1024;
const sizes = (process.env.DOWNLOAD_MEMORY_SIZES_MB ?? "8,128").split(",").map(Number);

/** Deterministic pattern so the checksum can be computed without storing bytes. */
function fillChunk(index: number): Buffer {
  const chunk = Buffer.alloc(CHUNK);
  chunk.fill(index & 0xff);
  return chunk;
}

function checksumOf(sizeBytes: number): string {
  const hash = createHash("sha256");
  let produced = 0;
  for (let index = 0; produced < sizeBytes; index += 1) {
    const size = Math.min(CHUNK, sizeBytes - produced);
    hash.update(fillChunk(index).subarray(0, size));
    produced += size;
  }
  return hash.digest("hex");
}

/**
 * Downloads in a separate process and counts received bytes without keeping
 * them, so the server's memory is what is measured.
 */
function downloadOverSocket(baseUrl: string, id: string, session: string): Promise<number> {
  const script = `
    const http = require("node:http");
    let n = 0;
    http.get(process.argv[1], { headers: { cookie: "omnicloud_session=" + process.argv[2] } }, (res) => {
      if (res.statusCode !== 200) { console.error(res.statusCode); process.exit(2); }
      res.on("data", (d) => { n += d.length; });
      res.on("end", () => { console.log(n); process.exit(0); });
      res.on("error", () => process.exit(3));
    });`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "-e",
      script,
      `${baseUrl}/api/files/${id}/download`,
      session,
    ]);
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`download client exited ${code}`));
      else resolve(Number(out.trim()));
    });
  });
}

/** Generates the object on demand: nothing is retained between chunks. */
class GeneratedProvider extends FakeStorageProvider {
  private sizes = new Map<string, number>();

  override async getStream(ref: { messageId: string }): Promise<Readable> {
    const sizeBytes = this.sizes.get(ref.messageId) ?? 0;
    let produced = 0;
    let index = 0;
    return new Readable({
      read() {
        if (produced >= sizeBytes) {
          this.push(null);
          return;
        }
        const size = Math.min(CHUNK, sizeBytes - produced);
        produced += size;
        this.push(fillChunk(index).subarray(0, size));
        index += 1;
      },
    });
  }

  register(messageId: string, sizeBytes: number): void {
    this.sizes.set(messageId, sizeBytes);
  }
}

/**
 * Creates a real file record through the upload service, then points it at a
 * generated object of the requested size. The download route and integrity gate
 * under test are the production ones; only the stored bytes are generated.
 */
async function createRecordFor(
  h: Awaited<ReturnType<typeof createTestHarness>>,
  provider: GeneratedProvider,
  session: string,
  sizeBytes: number,
): Promise<string> {
  const seed = await h.app.inject({
    method: "POST",
    url: "/api/files",
    headers: { "content-type": "multipart/form-data; boundary=seedboundary" },
    payload: `--seedboundary\r\nContent-Disposition: form-data; name="file"; filename="seed-${sizeBytes}.bin"\r\nContent-Type: application/octet-stream\r\n\r\nseed\r\n--seedboundary--\r\n`,
    cookies: { omnicloud_session: session },
  });
  if (seed.statusCode !== 201) throw new Error(`seed upload failed: ${seed.statusCode}`);
  const id = seed.json().file.id as string;
  const record = h.repos._files.find((f) => f.id === id);
  if (!record) throw new Error("seed record missing");
  const messageId = String(record.telegramMessageId);
  provider.register(messageId, sizeBytes);
  record.size = sizeBytes;
  record.sha256 = checksumOf(sizeBytes);
  return id;
}

async function main(): Promise<void> {
  const provider = new GeneratedProvider();
  const h = await createTestHarness(512 * MB, provider as never);
  const session = await h.login();
  const baseUrl = await h.app.listen({ port: 0, host: "127.0.0.1" });

  const results: Array<{ sizeMb: number; peakMb: number }> = [];
  for (const sizeMb of sizes) {
    const sizeBytes = sizeMb * MB;
    const uploadId = await createRecordFor(h, provider, session, sizeBytes);
    const base = process.memoryUsage().arrayBuffers;
    let peak = base;
    const sampler = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().arrayBuffers);
    }, 5);
    try {
      const bytes = await downloadOverSocket(baseUrl, uploadId, session);
      if (bytes !== sizeBytes) throw new Error(`short download: ${bytes} of ${sizeBytes}`);
    } finally {
      clearInterval(sampler);
    }
    results.push({ sizeMb, peakMb: (peak - base) / MB });
    console.log(
      `download ${sizeMb} MB: peak live external memory +${((peak - base) / MB).toFixed(1)} MB`,
    );
  }
  await h.app.close();

  const largest = results[results.length - 1]!;
  const ceilingMb = Number(process.env.DOWNLOAD_MEMORY_CEILING_MB ?? 64);
  console.log(
    `largest download peaked at +${largest.peakMb.toFixed(1)} MB (ceiling ${ceilingMb} MB, file ${largest.sizeMb} MB)`,
  );
  if (largest.peakMb > ceilingMb) {
    console.error("FAIL: download memory exceeds the ceiling; the response is likely buffered");
    process.exitCode = 1;
  }
}

main().then(() => process.exit(process.exitCode ?? 0));
