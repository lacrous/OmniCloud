import { describe, expect, it } from "vitest";
import { canTransition, isTerminal, isValidOperationId } from "../src/services/upload-operation";

describe("upload operation state machine", () => {
  it("moves forward through PENDING, UPLOADING, COMPLETED", () => {
    expect(canTransition("PENDING", "UPLOADING")).toBe(true);
    expect(canTransition("UPLOADING", "COMPLETED")).toBe(true);
  });

  it("never moves a completed operation anywhere, so a replay cannot re-upload", () => {
    expect(canTransition("COMPLETED", "UPLOADING")).toBe(false);
    expect(canTransition("COMPLETED", "PENDING")).toBe(false);
    expect(canTransition("COMPLETED", "FAILED")).toBe(false);
    expect(isTerminal("COMPLETED")).toBe(true);
  });

  it("does not allow skipping the upload step", () => {
    expect(canTransition("PENDING", "COMPLETED")).toBe(false);
  });

  it("treats FAILED as terminal too", () => {
    expect(isTerminal("FAILED")).toBe(true);
    expect(canTransition("FAILED", "UPLOADING")).toBe(false);
  });

  it("accepts only bounded, URL-safe operation ids", () => {
    expect(isValidOperationId("op_1234abcd")).toBe(true);
    expect(isValidOperationId("short")).toBe(false);
    expect(isValidOperationId("has spaces in it")).toBe(false);
    expect(isValidOperationId("x".repeat(65))).toBe(false);
    expect(isValidOperationId("../../etc/passwd")).toBe(false);
  });
});
