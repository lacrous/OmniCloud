import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { PayloadTooLargeError } from "../errors";

export interface SpooledFile {
  /** Path to the temporary copy. The caller must call `discard()` when done. */
  path: string;
  size: number;
  sha256: string;
  discard: () => Promise<void>;
}

/**
 * Writes an upload stream to a temporary file while computing its SHA-256 and
 * byte count. Memory use is bounded by the stream's chunk size, not the file
 * size. The size cap is enforced while writing, so an oversized upload is
 * rejected without being stored in full.
 */
const SPOOL_PREFIX = "omnicloud-upload-";

export async function spoolToFile(source: Readable, maxBytes: number): Promise<SpooledFile> {
  const dir = await mkdtemp(join(tmpdir(), `${SPOOL_PREFIX}${process.pid}-`));
  const path = join(dir, "payload");
  const discard = () => rm(dir, { recursive: true, force: true });

  const hash = createHash("sha256");
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.byteLength;
      if (size > maxBytes) {
        callback(
          new PayloadTooLargeError(
            `Files larger than ${Math.floor(maxBytes / (1024 * 1024))} MB are not supported`,
          ),
        );
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(source, meter, createWriteStream(path));
  } catch (error) {
    await discard();
    throw error;
  }

  return { path, size, sha256: hash.digest("hex"), discard };
}

/** True when a process with this PID exists and is not just a stale record. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Removes spool directories left by processes that are no longer running,
 * which happens when a process is killed mid-upload and `finally` cannot run.
 * Directories owned by a live process are never touched, so a concurrent
 * upload's bytes are not deleted.
 */
export async function sweepStaleSpools(): Promise<number> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(tmpdir()).catch(() => [] as string[]);
  let removed = 0;
  for (const name of entries) {
    if (!name.startsWith(SPOOL_PREFIX)) continue;
    const pid = Number(name.slice(SPOOL_PREFIX.length).split("-")[0]);
    if (!Number.isInteger(pid) || pid <= 0 || isAlive(pid)) continue;
    await rm(join(tmpdir(), name), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}
