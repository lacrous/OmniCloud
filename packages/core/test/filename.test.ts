import { describe, expect, it } from "vitest";
import { sanitizeFileName } from "../src/utils/filename";

describe("sanitizeFileName", () => {
  it("keeps plain names", () => {
    expect(sanitizeFileName("report.pdf")).toBe("report.pdf");
  });

  it("strips path components to prevent traversal", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("a/b/c.txt")).toBe("c.txt");
    expect(sanitizeFileName("..\\..\\secret.txt")).toBe("secret.txt");
  });

  it("rejects dot names", () => {
    expect(sanitizeFileName(".")).toBe("");
    expect(sanitizeFileName("..")).toBe("");
  });

  it("rejects empty and whitespace-only names", () => {
    expect(sanitizeFileName("")).toBe("");
    expect(sanitizeFileName("   ")).toBe("");
  });

  it("replaces unsafe characters", () => {
    expect(sanitizeFileName('file:<>*?"|.txt')).toBe("file_______.txt");
  });

  it("strips control characters", () => {
    expect(sanitizeFileName("bad\u0000name\u001f.txt")).toBe("badname.txt");
  });

  it("truncates very long names", () => {
    const long = `${"a".repeat(300)}.txt`;
    expect(sanitizeFileName(long).length).toBe(255);
  });
});
