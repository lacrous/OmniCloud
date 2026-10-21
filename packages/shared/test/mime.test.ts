import { describe, expect, it } from "vitest";
import {
  DEFAULT_MIME_TYPE,
  FILE_CATEGORIES,
  fileCategory,
  fileExtension,
  isFileCategory,
  mimeFromFilename,
  mimeMatchersForType,
} from "../src/mime";

describe("fileExtension", () => {
  it("returns the extension without the dot, lowercased", () => {
    expect(fileExtension("report.pdf")).toBe("pdf");
    expect(fileExtension("REPORT.PDF")).toBe("pdf");
    expect(fileExtension("archive.tar.gz")).toBe("gz");
  });

  it("ignores directories when finding the extension", () => {
    expect(fileExtension("/home/user/notes.md")).toBe("md");
    expect(fileExtension("C:\\Users\\me\\notes.md")).toBe("md");
  });

  it("does not mistake a dotted directory for an extension", () => {
    expect(fileExtension("/home/user.name/notes")).toBe("");
    expect(fileExtension("/home/user.name/notes.md")).toBe("md");
  });

  it("returns nothing for a name with no extension", () => {
    expect(fileExtension("README")).toBe("");
    expect(fileExtension("")).toBe("");
  });

  it("does not treat a leading dot as an extension", () => {
    expect(fileExtension(".gitignore")).toBe("");
  });

  it("returns nothing for a trailing dot", () => {
    expect(fileExtension("report.")).toBe("");
  });
});

describe("mimeFromFilename", () => {
  it("derives the type from the extension", () => {
    expect(mimeFromFilename("report.pdf")).toBe("application/pdf");
    expect(mimeFromFilename("photo.PNG")).toBe("image/png");
    expect(mimeFromFilename("clip.mp4")).toBe("video/mp4");
  });

  it("falls back to the default type for an unknown extension", () => {
    expect(mimeFromFilename("thing.qqq")).toBe(DEFAULT_MIME_TYPE);
    expect(mimeFromFilename("README")).toBe(DEFAULT_MIME_TYPE);
  });

  it("uses only the final extension, so a double extension is not misread", () => {
    // report.pdf.exe is an executable, not a PDF, and must not be treated as
    // one anywhere the type is derived from the name.
    expect(mimeFromFilename("report.pdf.exe")).not.toBe("application/pdf");
    expect(fileCategory(mimeFromFilename("report.pdf.exe"))).toBe("other");
  });
});

describe("fileCategory", () => {
  it("categorises by MIME prefix", () => {
    expect(fileCategory("image/png")).toBe("image");
    expect(fileCategory("video/mp4")).toBe("video");
    expect(fileCategory("audio/mpeg")).toBe("audio");
    expect(fileCategory("text/csv")).toBe("text");
  });

  it("categorises PDFs and archives by their exact type", () => {
    expect(fileCategory("application/pdf")).toBe("pdf");
    expect(fileCategory("application/zip")).toBe("archive");
    expect(fileCategory("application/x-7z-compressed")).toBe("archive");
  });

  it("categorises office documents", () => {
    expect(
      fileCategory("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ).toBe("document");
    expect(fileCategory("application/rtf")).toBe("document");
    expect(fileCategory("application/epub+zip")).toBe("document");
  });

  it("falls back to other for an unknown type", () => {
    expect(fileCategory("application/x-not-a-real-type")).toBe("other");
    expect(fileCategory("")).toBe("other");
  });
});

describe("isFileCategory", () => {
  it("accepts the known categories", () => {
    for (const category of FILE_CATEGORIES) {
      expect(isFileCategory(category)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    expect(isFileCategory("binary")).toBe(false);
    expect(isFileCategory("")).toBe(false);
  });
});

describe("mimeMatchersForType", () => {
  it("expands a coarse category into its MIME prefixes", () => {
    expect(mimeMatchersForType("image")).toEqual(["image/"]);
    expect(mimeMatchersForType("text")).toContain("text/");
    expect(mimeMatchersForType("text")).toContain("application/json");
  });

  it("expands archive and document categories", () => {
    expect(mimeMatchersForType("archive")).toContain("application/zip");
    expect(mimeMatchersForType("document")).toContain("application/rtf");
  });

  it("passes an exact MIME type through", () => {
    expect(mimeMatchersForType("application/pdf")).toEqual(["application/pdf"]);
  });

  it("normalizes case and whitespace", () => {
    expect(mimeMatchersForType("  IMAGE  ")).toEqual(["image/"]);
    expect(mimeMatchersForType("APPLICATION/PDF")).toEqual(["application/pdf"]);
  });

  it("returns null for a category with no matchers and for an empty value", () => {
    expect(mimeMatchersForType("other")).toBeNull();
    expect(mimeMatchersForType("")).toBeNull();
    expect(mimeMatchersForType("   ")).toBeNull();
  });
});
