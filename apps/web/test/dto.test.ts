import { describe, expect, it } from "vitest";
import { isFileDTO, isFolderDTO } from "../src/lib/dto";

const file = {
  id: "f1",
  name: "report.pdf",
  size: 2097152,
  mimeType: "application/pdf",
  sha256: "a".repeat(64),
  folderId: null,
  starred: false,
  trashed: false,
  deletedAt: null,
  versionCount: 2,
  currentVersionId: "v2",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
};

describe("isFileDTO", () => {
  it("accepts a complete file", () => {
    expect(isFileDTO(file)).toBe(true);
  });

  it("accepts a file with the optional encryption fields absent", () => {
    expect(isFileDTO({ ...file, encryptionFormat: null, wrappedKey: null })).toBe(true);
  });

  it("accepts a file with the optional encryption fields present", () => {
    expect(
      isFileDTO({
        ...file,
        encryptionFormat: "OCE1",
        wrappedKey: "w",
        metadataBlob: "m",
        keyEpoch: 0,
      }),
    ).toBe(true);
  });

  it("rejects a file that is missing a field", () => {
    const { size: _size, ...withoutSize } = file;
    expect(isFileDTO(withoutSize)).toBe(false);
  });

  it("rejects a field that has the wrong type", () => {
    expect(isFileDTO({ ...file, size: "2097152" })).toBe(false);
    expect(isFileDTO({ ...file, starred: "false" })).toBe(false);
    expect(isFileDTO({ ...file, folderId: undefined })).toBe(false);
    expect(isFileDTO({ ...file, versionCount: Number.NaN })).toBe(false);
  });

  it("rejects values that are not objects at all", () => {
    expect(isFileDTO(null)).toBe(false);
    expect(isFileDTO(undefined)).toBe(false);
    expect(isFileDTO("file")).toBe(false);
    expect(isFileDTO([])).toBe(false);
  });
});

describe("isFolderDTO", () => {
  const folder = {
    id: "d1",
    name: "Documents",
    parentId: null,
    starred: false,
    trashed: false,
    deletedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
  };

  it("accepts a complete folder", () => {
    expect(isFolderDTO(folder)).toBe(true);
  });

  it("rejects a folder that is missing a field", () => {
    const { parentId: _parentId, ...withoutParent } = folder;
    expect(isFolderDTO(withoutParent)).toBe(false);
  });

  it("rejects a field that has the wrong type", () => {
    expect(isFolderDTO({ ...folder, starred: 0 })).toBe(false);
    expect(isFolderDTO({ ...folder, deletedAt: 123 })).toBe(false);
  });
});
