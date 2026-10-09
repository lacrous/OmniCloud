import { describe, expect, it } from "vitest";
import { reconcile, type ReferenceSet } from "../src/services/reconciliation";

const refs = (file: number[], pending: number[] = []): ReferenceSet => ({
  fileMessageIds: new Set(file),
  pendingUploadMessageIds: new Set(pending),
});

describe("reconciliation classification", () => {
  it("reports nothing when every channel message is referenced", () => {
    const report = reconcile(
      [
        { messageId: 1, sizeBytes: 10 },
        { messageId: 2, sizeBytes: 20 },
      ],
      refs([1, 2]),
    );
    expect(report.unknown).toEqual([]);
    expect(report.dangling).toEqual([]);
    expect(report.referencedMessages).toBe(2);
  });

  it("reports a channel message that no record references as unknown", () => {
    const report = reconcile([{ messageId: 7, sizeBytes: 99 }], refs([]));
    expect(report.unknown).toEqual([{ kind: "unknown", messageId: 7, sizeBytes: 99 }]);
  });

  it("reports a record whose message is gone as dangling", () => {
    const report = reconcile([], refs([5]));
    expect(report.dangling).toEqual([{ kind: "dangling", messageId: 5, recordedBy: "file" }]);
  });

  it("treats a message stored by an in-flight upload as referenced, not unknown", () => {
    const report = reconcile([{ messageId: 8, sizeBytes: 1 }], refs([], [8]));
    expect(report.unknown).toEqual([]);
    expect(report.referencedMessages).toBe(1);
  });

  it("never classifies anything as deletable: the report has no removal output", () => {
    const report = reconcile([{ messageId: 1, sizeBytes: 1 }], refs([]));
    expect(Object.keys(report).sort()).toEqual(
      ["dangling", "referencedMessages", "scannedMessages", "unknown"].sort(),
    );
  });
});
