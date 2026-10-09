import { describe, expect, it } from "vitest";
import { sanitizeFileName } from "../src/utils/filename";

describe("sanitizeFileName removes invisible and direction-changing characters", () => {
  it("removes a right-to-left override that would make a name show a false extension", () => {
    const spoofed = "report\u202Efdp.exe";
    expect(sanitizeFileName(spoofed)).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
  });

  it("removes zero-width characters", () => {
    expect(sanitizeFileName("me\u200Bnu.txt")).toBe("menu.txt");
  });

  it("removes C1 control characters", () => {
    expect(sanitizeFileName("a\u0085b.txt")).toBe("ab.txt");
  });

  it("keeps ordinary non-Latin names intact", () => {
    expect(sanitizeFileName("отчёт 2026.pdf")).toBe("отчёт 2026.pdf");
  });
});
