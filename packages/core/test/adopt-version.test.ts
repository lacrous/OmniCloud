import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { ReconciliationApplier } from "../src/services/reconciliation-apply";
import { createInMemoryRepos, makeUser } from "./fakes";

const BYTES = Buffer.from("adopted bytes");
const SHA = createHash("sha256").update(BYTES).digest("hex");

function engine(objects: Map<string, Buffer>) {
  return {
    async stat(ref: { messageId: string }) {
      const data = objects.get(ref.messageId);
      return data
        ? { name: "o.bin", size: data.byteLength, mimeType: "application/octet-stream" }
        : null;
    },
    async hashObject(ref: { messageId: string }) {
      const data = objects.get(ref.messageId)!;
      return { sha256: SHA, size: data.byteLength };
    },
  };
}

describe("adopting an unknown object records a usable current version", () => {
  it("sets the current version and its count on the adopted file", async () => {
    const repos = createInMemoryRepos();
    const user = makeUser();
    const applier = new ReconciliationApplier(
      repos,
      user.id,
      engine(new Map([["77", BYTES]])) as never,
    );

    await applier.apply([
      {
        id: "adopt-77",
        kind: "adopt-unknown",
        messageId: 77,
        sizeBytes: BYTES.byteLength,
        reason: "x",
        destructive: false,
      },
    ]);

    const created = (await repos.files.listByUser(user.id))[0];
    expect(created?.versionCount).toBe(1);
    expect(created?.currentVersionId).not.toBeNull();
    const versions = await repos.files.listVersions(created!.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.id).toBe(created!.currentVersionId);
  });
});
