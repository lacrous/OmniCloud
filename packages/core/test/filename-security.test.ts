import { describe, expect, it } from "vitest";
import { sanitizeFileName } from "../src/utils/filename";

describe("filename sanitizing against hostile names", () => {
  it.each([
    ["../../etc/passwd", "passwd"],
    ["..\\..\\windows\\system32\\cfg", "cfg"],
    ["/absolute/path/file.txt", "file.txt"],
    ["C:\\temp\\evil.exe", "evil.exe"],
  ])("keeps only the final component of %s", (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it("refuses names that are only traversal", () => {
    expect(sanitizeFileName("..")).toBe("");
    expect(sanitizeFileName(".")).toBe("");
    expect(sanitizeFileName("../..")).toBe("");
  });

  it("removes control characters, including a null byte that could truncate paths", () => {
    expect(sanitizeFileName("safe\u0000.txt")).toBe("safe.txt");
    expect(sanitizeFileName("line\nbreak.txt")).toBe("linebreak.txt");
  });

  it("replaces characters that are unsafe on common filesystems", () => {
    expect(sanitizeFileName('a<b>c:d"e|f?g*h.txt')).toBe("a_b_c_d_e_f_g_h.txt");
  });

  it("caps very long names so they cannot exceed filesystem limits", () => {
    expect(sanitizeFileName("x".repeat(400)).length).toBe(255);
  });

  it("keeps a normal name unchanged", () => {
    expect(sanitizeFileName("report 2026 (final).pdf")).toBe("report 2026 (final).pdf");
  });
});
