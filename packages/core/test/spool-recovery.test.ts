import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sweepStaleSpools } from "../src/utils/spool";

const PREFIX = "omnicloud-upload-";

/** A PID that is guaranteed not to be running: spawn and reap a process. */
async function deadPid(): Promise<number> {
  const { spawnSync } = await import("node:child_process");
  const child = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  return child.pid!;
}

describe("spool recovery after a crashed process", () => {
  it("removes a spool whose owning process no longer exists", async () => {
    const pid = await deadPid();
    const dir = join(tmpdir(), `${PREFIX}${pid}-orphan`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "payload"), Buffer.alloc(1024, 9));

    const removed = await sweepStaleSpools();

    expect(removed).toBeGreaterThanOrEqual(1);
    await expect(stat(dir)).rejects.toThrow();
  });

  it("never removes a spool owned by a live process", async () => {
    const dir = join(tmpdir(), `${PREFIX}${process.pid}-live`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "payload"), Buffer.from("in flight"));
    try {
      await sweepStaleSpools();
      expect((await stat(dir)).isDirectory()).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
