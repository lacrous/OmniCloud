import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { ReconciliationApplier } from "../src/services/reconciliation-apply";
import { createInMemoryRepos, makeUser } from "./fakes";

const BYTES = Buffer.alloc(2 * 1024 * 1024, "z");
const SHA = createHash("sha256").update(BYTES).digest("hex");

function engine(objects: Map<string, Buffer>, calls: string[]) {
  return {
    async stat(ref: { messageId: string }) {
      calls.push(`stat:${ref.messageId}`);
      const data = objects.get(ref.messageId);
      return data
        ? { name: "o.bin", size: data.byteLength, mimeType: "application/octet-stream" }
        : null;
    },
    async download(ref: { messageId: string }) {
      calls.push(`download:${ref.messageId}`);
      return objects.get(ref.messageId)!;
    },
    async hashObject(ref: { messageId: string }) {
      calls.push(`hashObject:${ref.messageId}`);
      const data = objects.get(ref.messageId)!;
      return { sha256: SHA, size: data.byteLength };
    },
  };
}

describe("adopting a large unknown object", () => {
  it("hashes it by streaming, without buffering the whole object through download", async () => {
    const repos = createInMemoryRepos();
    const user = makeUser();
    const calls: string[] = [];
    const eng = engine(new Map([["9001", BYTES]]), calls);
    const applier = new ReconciliationApplier(repos, user.id, eng as never);

    await applier.apply([
      {
        id: "adopt-9001",
        kind: "adopt-unknown",
        messageId: 9001,
        sizeBytes: BYTES.byteLength,
        reason: "x",
        destructive: false,
      },
    ]);

    expect(calls).toContain("hashObject:9001");
    expect(calls.some((c) => c.startsWith("download:"))).toBe(false);
    const created = (await repos.files.listByUser(user.id))[0];
    expect(created?.sha256).toBe(SHA);
    expect(created?.size).toBe(BYTES.byteLength);
  });
});
