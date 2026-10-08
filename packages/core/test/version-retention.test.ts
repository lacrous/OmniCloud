import { describe, expect, it } from "vitest";
import { DEFAULT_RETENTION, versionsToPrune } from "../src/services/version-retention";
import type { FileVersionRecord } from "../src/types";

const NOW = new Date("2026-10-09T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function version(n: number, ageDays: number): FileVersionRecord {
  return {
    id: `v${n}`,
    fileId: "f1",
    userId: "u1",
    versionNumber: n,
    size: 1,
    mimeType: "text/plain",
    sha256: "x",
    telegramMessageId: n,
    createdAt: new Date(NOW.getTime() - ageDays * DAY),
  };
}

const versions = [version(1, 100), version(2, 40), version(3, 10), version(4, 1)];

describe("version retention", () => {
  it("defaults to keeping every version", () => {
    expect(versionsToPrune(versions, "v4", DEFAULT_RETENTION, NOW)).toEqual([]);
  });

  it("never selects the current version, under any policy", () => {
    const current = "v1";
    const byCount = versionsToPrune(versions, current, { kind: "KEEP_LATEST_N", count: 0 }, NOW);
    const byAge = versionsToPrune(versions, current, { kind: "KEEP_FOR_DAYS", days: 0 }, NOW);
    expect(byCount.map((v) => v.id)).not.toContain(current);
    expect(byAge.map((v) => v.id)).not.toContain(current);
  });

  it("KEEP_LATEST_N keeps the newest N historical versions", () => {
    const pruned = versionsToPrune(versions, "v4", { kind: "KEEP_LATEST_N", count: 1 }, NOW);
    expect(pruned.map((v) => v.id).sort()).toEqual(["v1", "v2"]);
  });

  it("KEEP_FOR_DAYS prunes only historical versions older than the window", () => {
    const pruned = versionsToPrune(versions, "v4", { kind: "KEEP_FOR_DAYS", days: 30 }, NOW);
    expect(pruned.map((v) => v.id).sort()).toEqual(["v1", "v2"]);
  });

  it("with no current version recorded, every version is a candidate", () => {
    const pruned = versionsToPrune(versions, null, { kind: "KEEP_LATEST_N", count: 0 }, NOW);
    expect(pruned).toHaveLength(4);
  });

  it("never removes anything when N is at least the number of versions", () => {
    expect(versionsToPrune(versions, "v4", { kind: "KEEP_LATEST_N", count: 10 }, NOW)).toEqual([]);
  });
});
