/**
 * Measures server-side memory during uploads, end to end over a real socket.
 *
 * Run with GC exposed so the figures are live memory, not garbage:
 *
 *   pnpm --filter @omnicloud/api measure:upload-memory
 *
 * The sender runs in a separate process. Measuring in the same process as the
 * test runner or the in-memory fake provider counts their buffers as server
 * growth, which is how an earlier, incorrect "memory grows with file size"
 * conclusion was reached.
 */
import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import type { StorageUploadInput, StoredObject } from "@omnicloud/core";
import { createTestHarness } from "./harness";
import { FakeStorageProvider } from "./repos";

/**
 * Reads a spooled upload in slices and keeps only its metadata, the way a real
 * provider sends bytes onward without retaining them. Storing the object (as
 * the functional fake does) would count the stored copy as upload memory.
 */
class DiscardingProvider extends FakeStorageProvider {
  override async put(input: StorageUploadInput): Promise<StoredObject> {
    const size = input.size ?? input.data?.byteLength ?? 0;
    if (input.path) {
      const handle = await open(input.path, "r");
      try {
        const slice = Buffer.alloc(512 * 1024);
        let offset = 0;
        while (offset < size) {
          const { bytesRead } = await handle.read(slice, 0, slice.length, offset);
          if (bytesRead === 0) break;
          offset += bytesRead;
        }
      } finally {
        await handle.close();
      }
    }
    return { messageId: String(size), name: input.name, size, mimeType: input.mimeType };
  }
}

const MB = 1024 * 1024;
const sizes = (process.env.UPLOAD_MEMORY_SIZES_MB ?? "8,64").split(",").map(Number);

const liveExternalBytes = () => {
  (globalThis as { gc?: () => void }).gc?.();
  return process.memoryUsage().arrayBuffers;
};

const SENDER = `
const { request } = require("node:http");
const [port, sizeMb, session] = [Number(process.argv[1]), Number(process.argv[2]), process.argv[3]];
const MB = 1024 * 1024;
const boundary = "----omnicloudmemory";
const head = Buffer.from('--' + boundary + '\\r\\nContent-Disposition: form-data; name="file"; filename="memory.bin"\\r\\nContent-Type: application/octet-stream\\r\\n\\r\\n');
const tail = Buffer.from('\\r\\n--' + boundary + '--\\r\\n');
const limit = sizeMb * MB;
const slice = Buffer.alloc(64 * 1024, 4);
const req = request({ host: "127.0.0.1", port, path: "/api/files", method: "POST",
  headers: { "content-type": "multipart/form-data; boundary=" + boundary,
    "content-length": head.length + limit + tail.length, cookie: "omnicloud_session=" + session } },
  (res) => { res.resume(); res.on("end", () => { console.log(res.statusCode); process.exit(0); }); });
req.write(head);
let sent = 0;
const pump = () => {
  while (sent < limit) {
    const n = Math.min(slice.length, limit - sent);
    sent += n;
    if (!req.write(slice.subarray(0, n))) { req.once("drain", pump); return; }
  }
  req.end(tail);
};
pump();
`;

async function uploadFrom(port: number, sizeMb: number, session: string): Promise<number> {
  const base = liveExternalBytes();
  let peak = base;
  const sampler = setInterval(
    () => {
      peak = Math.max(peak, liveExternalBytes());
    },
    Number(process.env.UPLOAD_MEMORY_SAMPLE_MS ?? 250),
  );
  try {
    const status = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["-e", SENDER, String(port), String(sizeMb), session]);
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.on("error", reject);
      child.on("close", () => resolve(out.trim()));
    });
    if (status !== "201") throw new Error(`upload returned ${status}`);
  } finally {
    clearInterval(sampler);
  }
  return peak - base;
}

async function main(): Promise<void> {
  const h = await createTestHarness(512 * MB, new DiscardingProvider());
  const session = await h.login();
  const url = await h.app.listen({ port: 0, host: "127.0.0.1" });
  const port = Number(new URL(url).port);

  const results: Array<{ sizeMb: number; peakMb: number }> = [];
  for (const sizeMb of sizes) {
    const growth = await uploadFrom(port, sizeMb, session);
    results.push({ sizeMb, peakMb: growth / MB });
    console.log(`upload ${sizeMb} MB: peak live external memory +${(growth / MB).toFixed(1)} MB`);
  }
  await h.app.close();

  const largest = results[results.length - 1]!;
  const smallest = results[0]!;
  const ratio = largest.peakMb / Math.max(smallest.peakMb, 1);
  const sizeRatio = largest.sizeMb / smallest.sizeMb;
  console.log(`file size grew ${sizeRatio.toFixed(1)}x; memory grew ${ratio.toFixed(2)}x`);
  if (ratio > 2) {
    console.error("FAIL: upload memory scales with file size");
    process.exitCode = 1;
  }
}

main().then(() => process.exit(process.exitCode ?? 0));
