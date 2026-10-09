import { describe, expect, it } from "vitest";
import { ReconciliationFlow } from "../src/services/reconciliation-flow";
import { FakeStorageProvider, createInMemoryRepos, makeUser } from "./fakes";
import { StorageEngine } from "../src/storage/engine";

function setup() {
  const repos = createInMemoryRepos();
  const provider = new FakeStorageProvider();
  const engine = new StorageEngine(provider, { attempts: 1, baseDelayMs: 0 });
  const flow = new ReconciliationFlow(repos, async () => engine);
  return { repos, provider, flow, user: makeUser() };
}

describe("reconciliation repair flow", () => {
  it("the plan lists an unknown object, and apply adopts it after approval", async () => {
    const { provider, flow, user, repos } = setup();
    const stored = await provider.put({
      name: "lost.bin",
      mimeType: "application/octet-stream",
      data: Buffer.from("lost"),
    });

    const plan = await flow.plan(user.id);
    const id = `adopt-${stored.messageId}`;
    expect(plan.actions.map((a) => a.id)).toContain(id);

    const result = await flow.apply(user.id, [id]);
    expect(result.applied.map((a) => a.id)).toEqual([id]);
    expect(repos._files).toHaveLength(1);
    expect(provider.objects.has(stored.messageId)).toBe(true);
  });

  it("refuses an approval that the fresh scan no longer offers", async () => {
    const { provider, flow, user } = setup();
    const stored = await provider.put({
      name: "lost.bin",
      mimeType: "application/octet-stream",
      data: Buffer.from("lost"),
    });
    const approvedId = `adopt-${stored.messageId}`;
    // The object disappears from the channel between the plan and the apply.
    provider.objects.delete(stored.messageId);

    await expect(flow.apply(user.id, [approvedId])).rejects.toThrow(/not offered/);
  });

  it("applies nothing when no id is approved", async () => {
    const { provider, flow, user, repos } = setup();
    await provider.put({
      name: "lost.bin",
      mimeType: "application/octet-stream",
      data: Buffer.from("lost"),
    });
    const result = await flow.apply(user.id, []);
    expect(result.applied).toEqual([]);
    expect(repos._files).toHaveLength(0);
  });
});
