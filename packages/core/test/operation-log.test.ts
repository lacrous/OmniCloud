import { describe, expect, it } from "vitest";
import { timedOperation, type OperationSink } from "../src/utils/operation-log";
import { NotFoundError } from "../src/errors";

function recorder() {
  const lines: { level: string; record: Record<string, unknown>; message: string }[] = [];
  const sink: OperationSink = {
    info: (record, message) => lines.push({ level: "info", record, message }),
    warn: (record, message) => lines.push({ level: "warn", record, message }),
  };
  return { sink, lines };
}

describe("operation records", () => {
  it("records a successful upload with its duration, size and outcome", async () => {
    const { sink, lines } = recorder();
    let clock = 1000;
    const result = await timedOperation(
      sink,
      { operation: "upload", userId: "u1", resourceId: "f1", sizeBytes: 2048 },
      async () => {
        clock += 40;
        return "done";
      },
      () => clock,
    );
    expect(result).toBe("done");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "info",
      message: "upload.completed",
      record: {
        operation: "upload",
        durationMs: 40,
        sizeBytes: 2048,
        status: "ok",
        errorCode: null,
      },
    });
  });

  it("records a failure with its error code and rethrows the original error", async () => {
    const { sink, lines } = recorder();
    const error = new NotFoundError("File not found", "file");
    await expect(
      timedOperation(sink, { operation: "download", userId: "u1", resourceId: "f9" }, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(lines[0]).toMatchObject({
      level: "warn",
      message: "download.failed",
      record: { status: "error" },
    });
  });

  it("never includes file contents, only operational fields", async () => {
    const { sink, lines } = recorder();
    await timedOperation(
      sink,
      { operation: "upload", userId: "u1", sizeBytes: 3 },
      async () => "x",
    );
    expect(Object.keys(lines[0]!.record).sort()).toEqual(
      [
        "durationMs",
        "errorCode",
        "operation",
        "resourceId",
        "sizeBytes",
        "status",
        "userId",
      ].sort(),
    );
  });

  it("does not let a failing logger change the operation's outcome", async () => {
    const broken: OperationSink = {
      info: () => {
        throw new Error("log sink down");
      },
      warn: () => {
        throw new Error("log sink down");
      },
    };
    await expect(
      timedOperation(broken, { operation: "delete", userId: "u1" }, async () => 42),
    ).resolves.toBe(42);
  });

  it("runs with no sink and still returns the result", async () => {
    await expect(
      timedOperation(null, { operation: "delete", userId: "u1" }, async () => 7),
    ).resolves.toBe(7);
  });
});
