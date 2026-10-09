import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { ReconciliationApplier } from "../src/services/reconciliation-apply";
import type { RepairAction } from "../src/services/reconciliation-repair";
import { createInMemoryRepos, makeUser } from "./fakes";

function engineWith(objects: Map<string, Buffer>) {
  const calls: string[] = [];
  return {
    calls,
    engine: {
      async stat(ref: { messageId: string }) {
        calls.push(`stat:${ref.messageId}`);
        const data = objects.get(ref.messageId);
        return data
          ? { name: "orphan.bin", size: data.byteLength, mimeType: "application/octet-stream" }
          : null;
      },
      async download(ref: { messageId: string }) {
        calls.push(`download:${ref.messageId}`);
        const data = objects.get(ref.messageId);
        if (!data) throw new Error("missing");
        return data;
      },
    },
  };
}

describe("applying approved repairs", () => {
  it("never calls delete on the storage provider", async () => {
    const repos = createInMemoryRepos();
    const user = makeUser();
    const { engine, calls } = engineWith(new Map([["77", Buffer.from("orphan bytes")]]));
    const applier = new ReconciliationApplier(repos, user.id, engine as never);
    const actions: RepairAction[] = [
      {
        id: "adopt-77",
        kind: "adopt-unknown",
        messageId: 77,
        sizeBytes: 12,
        reason: "x",
        destructive: false,
      },
    ];
    await applier.apply(actions);
    expect(calls.some((call) => call.startsWith("delete"))).toBe(false);
  });

  it("adopts an unknown object with its real checksum, not a placeholder", async () => {
    const repos = createInMemoryRepos();
    const user = makeUser();
    const bytes = Buffer.from("orphan bytes");
    const { engine } = engineWith(new Map([["77", bytes]]));
    const applier = new ReconciliationApplier(repos, user.id, engine as never);

    const result = await applier.apply([
      {
        id: "adopt-77",
        kind: "adopt-unknown",
        messageId: 77,
        sizeBytes: bytes.byteLength,
        reason: "x",
        destructive: false,
      },
    ]);

    expect(result.applied).toEqual([{ id: "adopt-77", kind: "adopt-unknown" }]);
    const expected = createHash("sha256").update(bytes).digest("hex");
    expect(repos._files[0]!.sha256).toBe(expected);
  });

  it("detaches a dangling file by marking it, never by deleting its metadata", async () => {
    const repos = createInMemoryRepos();
    const user = makeUser();
    const record = await repos.files.create({
      userId: user.id,
      folderId: null,
      name: "gone.txt",
      size: 3,
      mimeType: "text/plain",
      sha256: "h",
      telegramMessageId: 5,
    });
    const { engine } = engineWith(new Map());
    const applier = new ReconciliationApplier(repos, user.id, engine as never);

    await applier.apply([
      {
        id: "detach-file-5",
        kind: "detach-dangling",
        messageId: 5,
        recordedBy: "file",
        reason: "x",
        destructive: false,
      },
    ]);

    expect(repos._files.find((f) => f.id === record.id)).toBeDefined();
    expect(repos._files.find((f) => f.id === record.id)!.deletedAt).not.toBeNull();
  });

  it("reports a failed adoption and does not create a record for it", async () => {
    const repos = createInMemoryRepos();
    const user = makeUser();
    const { engine } = engineWith(new Map());
    const applier = new ReconciliationApplier(repos, user.id, engine as never);

    const result = await applier.apply([
      {
        id: "adopt-99",
        kind: "adopt-unknown",
        messageId: 99,
        sizeBytes: 1,
        reason: "x",
        destructive: false,
      },
    ]);

    expect(result.failed.map((f) => f.id)).toEqual(["adopt-99"]);
    expect(repos._files).toHaveLength(0);
  });
});

describe("apply result truthfulness", () => {
  it("does not report a detach as applied when no matching file exists", async () => {
    const repos = createInMemoryRepos();
    const user = makeUser();
    const { engine } = engineWith(new Map());
    const applier = new ReconciliationApplier(repos, user.id, engine as never);
    const actions: RepairAction[] = [
      {
        id: "detach-404",
        kind: "detach-dangling",
        messageId: 404,
        recordedBy: "file",
      } as RepairAction,
    ];

    const result = await applier.apply(actions);

    expect(result.applied).toEqual([]);
    expect(result.failed.map((f) => f.id)).toEqual(["detach-404"]);
  });
});
