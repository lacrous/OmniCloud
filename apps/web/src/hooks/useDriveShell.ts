import { createContext, useContext } from "react";
import type { RefObject } from "react";
import type { UploadsController } from "./useUploads";

/** Page-level keyboard handlers the active route registers with the layout. */
export interface PageShortcuts {
  onDelete?: () => void;
  onEnter?: () => void;
  onSelectAll?: () => void;
  onEscape?: () => void;
}

/** Shared chrome that pages reach into: uploads, active folder, search and help. */
export interface DriveShellValue {
  uploads: UploadsController;
  /** Folder the "New folder"/"Upload" actions target (null = root). */
  activeFolderId: string | null;
  setActiveFolderId: (folderId: string | null) => void;
  openCreateFolder: () => void;
  clearSearch: () => void;
  openShortcuts: () => void;
  searchInputRef: RefObject<HTMLInputElement>;
  /** Called by the active page to install its selection shortcuts. */
  registerPageShortcuts: (handlers: PageShortcuts | null) => void;
}

export const DriveShellContext = createContext<DriveShellValue | null>(null);

export function useDriveShell(): DriveShellValue {
  const value = useContext(DriveShellContext);
  if (value === null) {
    throw new Error("useDriveShell must be used within the drive layout");
  }
  return value;
}
