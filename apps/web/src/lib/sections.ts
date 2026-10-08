import { Clock, FolderOpen, HardDrive, Star, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DriveItem } from "../lib/drive";

/** Route sections rendered in the sidebar, header copy and empty states. */
export type SectionId = "drive" | "recent" | "starred" | "trash" | "storage";

export interface SectionConfig {
  id: SectionId;
  label: string;
  path: string;
  icon: LucideIcon;
  /** Search/aria label for the content region. */
  regionLabel: string;
}

export const SECTIONS: SectionConfig[] = [
  { id: "drive", label: "My Drive", path: "/", icon: FolderOpen, regionLabel: "My Drive" },
  { id: "recent", label: "Recent", path: "/recent", icon: Clock, regionLabel: "Recent files" },
  { id: "starred", label: "Starred", path: "/starred", icon: Star, regionLabel: "Starred items" },
  { id: "trash", label: "Trash", path: "/trash", icon: Trash2, regionLabel: "Trash" },
  { id: "storage", label: "Storage", path: "/storage", icon: HardDrive, regionLabel: "Storage" },
];

export interface ItemMenuContext {
  /** The section the items live in, which selects the available actions. */
  section: SectionId;
}

/** Sort field/order defaults per section. */
export function defaultSortFor(section: SectionId): {
  sort: "name" | "updatedAt";
  order: "asc" | "desc";
} {
  if (section === "recent") return { sort: "updatedAt", order: "desc" };
  return { sort: "name", order: "asc" };
}

export type { DriveItem };
