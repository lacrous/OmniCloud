import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { sweepStaleSpools } from "../src/utils/spool";

const PREFIX = "omnicloud-upload-";

/**
 * The child spools an endless stream to disk, then waits. The test kills it
 * with SIGKILL, so its `finally` cannot run: this is the crash the sweep exists
 * for. The spool module is bundled to plain JavaScript so a bare Node process
 * can load it without a TypeScript loader.
 */
const WRITER = `
import { Readable } from "node:stream";
import { spoolToFile } from "./spool.mjs";
const source = new Readable({
  read() {
    this.push(Buffer.alloc(64 * 1024, 7));
  },
});
console.log("spooling");
spoolToFile(source, 10 * 1024 * 1024 * 1024).then(() => process.exit(0));
`;

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "omnicloud-killtest-"));
  await build({
    entryPoints: [join(__dirname, "../src/utils/spool.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: join(workDir, "spool.mjs"),
    logLevel: "silent",
  });
  await writeFile(join(workDir, "writer.mjs"), WRITER);
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function spoolsOwnedBy(pid: number): Promise<string[]> {
  const entries = await readdir(tmpdir()).catch(() => [] as string[]);
  return entries.filter((name) => name.startsWith(`${PREFIX}${pid}-`));
}

describe("a process killed mid-upload leaves no orphaned spool", () => {
  it("removes the partially written spool after SIGKILL", async () => {
    const child = spawn(process.execPath, [join(workDir, "writer.mjs")], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("writer never started")), 30_000);
      child.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("spooling")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
      child.on("error", reject);
    });

    await new Promise((resolve) => setTimeout(resolve, 1500));
    const pid = child.pid!;
    const owned = await spoolsOwnedBy(pid);
    expect(owned.length).toBeGreaterThanOrEqual(1);
    const partial = await stat(join(tmpdir(), owned[0]!, "payload"));
    expect(partial.size).toBeGreaterThan(0);

    const exited = new Promise((resolve) => child.on("exit", resolve));
    child.kill("SIGKILL");
    await exited;

    const removed = await sweepStaleSpools();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await spoolsOwnedBy(pid)).toEqual([]);
  }, 120_000);
});
