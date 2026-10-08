import type { FileDTO, FolderDTO } from "@omnicloud/shared";
import type { ItemRef } from "../hooks/useSelection";

/**
 * A unified view model so files and folders can be rendered by the same list
 * and grid components across My Drive, Starred, Trash and Search.
 */
export interface DriveItem {
  kind: "file" | "folder";
  id: string;
  name: string;
  /** Bytes; folders report 0. */
  size: number;
  mimeType: string;
  starred: boolean;
  trashed: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  versionCount: number;
  /** The backing DTO for kind === "file" (null for folders). */
  file: FileDTO | null;
  /** The backing DTO for kind === "folder" (null for files). */
  folder: FolderDTO | null;
}

export function fileToItem(file: FileDTO): DriveItem {
  return {
    kind: "file",
    id: file.id,
    name: file.name,
    size: file.size,
    mimeType: file.mimeType,
    starred: file.starred,
    trashed: file.trashed,
    deletedAt: file.deletedAt,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    versionCount: file.versionCount,
    file,
    folder: null,
  };
}

export function folderToItem(folder: FolderDTO): DriveItem {
  return {
    kind: "folder",
    id: folder.id,
    name: folder.name,
    size: 0,
    mimeType: "",
    starred: folder.starred,
    trashed: folder.trashed,
    deletedAt: folder.deletedAt,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
    versionCount: 0,
    file: null,
    folder,
  };
}

/** Selection reference for a drive item. */
export function itemRef(item: DriveItem): ItemRef {
  return { kind: item.kind, id: item.id };
}

/** Stable selection key for a drive item. */
export function itemKeyOf(item: DriveItem): string {
  return `${item.kind}:${item.id}`;
}

export type ViewMode = "list" | "grid";

export function isViewMode(value: string): value is ViewMode {
  return value === "list" || value === "grid";
}
