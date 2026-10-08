import { File, FileArchive, FileText, Film, Image, Music } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { FileCategory } from "@omnicloud/shared";
import { fileCategory } from "@omnicloud/shared";

/** Icon per coarse file category, used by lists, grids and the details panel. */
export const CATEGORY_ICONS: Record<FileCategory, LucideIcon> = {
  image: Image,
  video: Film,
  audio: Music,
  archive: FileArchive,
  pdf: FileText,
  text: FileText,
  document: FileText,
  other: File,
};

/** Human label per category, e.g. "PDF". */
export const CATEGORY_LABELS: Record<FileCategory, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
  archive: "Archive",
  pdf: "PDF",
  text: "Text",
  document: "Document",
  other: "File",
};

const CATEGORY_COLORS: Record<FileCategory, string> = {
  image: "text-gold-text",
  video: "muted",
  audio: "muted",
  archive: "muted",
  pdf: "muted",
  text: "muted",
  document: "muted",
  other: "muted",
};

/** Resolves the icon and tint for a MIME type. */
export function fileVisual(mimeType: string): {
  Icon: LucideIcon;
  label: string;
  color: string;
} {
  const category = fileCategory(mimeType);
  return {
    Icon: CATEGORY_ICONS[category],
    label: CATEGORY_LABELS[category],
    color: CATEGORY_COLORS[category],
  };
}
