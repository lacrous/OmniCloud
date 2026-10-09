import { describe, expect, it } from "vitest";
import { planRepairs, selectApproved } from "../src/services/reconciliation-repair";
import type { ReconciliationReport } from "../src/services/reconciliation";

const report: ReconciliationReport = {
  scannedMessages: 3,
  referencedMessages: 1,
  unknown: [{ kind: "unknown", messageId: 9, sizeBytes: 40 }],
  dangling: [{ kind: "dangling", messageId: 5, recordedBy: "file" }],
};

describe("reconciliation repair planning", () => {
  it("offers one action per finding, with reasons", () => {
    const plan = planRepairs(report);
    expect(plan.actions.map((a) => a.kind).sort()).toEqual(["adopt-unknown", "detach-dangling"]);
    for (const action of plan.actions) expect(action.reason.length).toBeGreaterThan(20);
  });

  it("never proposes a deletion of any channel object", () => {
    const plan = planRepairs(report);
    expect(plan.deletions).toEqual([]);
    for (const action of plan.actions) expect(action.destructive).toBe(false);
  });

  it("refuses an approval for an action the plan did not offer", () => {
    const plan = planRepairs(report);
    expect(() => selectApproved(plan, ["delete-everything"])).toThrow(/not offered/);
  });

  it("applies only the approved ids and ignores duplicates", () => {
    const plan = planRepairs(report);
    const selected = selectApproved(plan, ["adopt-9", "adopt-9"]);
    expect(selected.map((a) => a.id)).toEqual(["adopt-9"]);
  });

  it("an empty report produces an empty plan", () => {
    const plan = planRepairs({
      scannedMessages: 0,
      referencedMessages: 0,
      unknown: [],
      dangling: [],
    });
    expect(plan.actions).toEqual([]);
  });
});
