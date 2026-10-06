import {
  Download,
  File,
  FileArchive,
  FileText,
  Film,
  FolderInput,
  Image,
  Music,
  Pencil,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { FileCategory, FileDTO } from "@omnicloud/shared";
import { fileCategory } from "@omnicloud/shared";
import { formatBytes, formatDate } from "../lib/format";
import { ItemMenu } from "./ItemMenu";

export type FileAction = "rename" | "move" | "download" | "delete";

const CATEGORY_ICONS: Record<FileCategory, LucideIcon> = {
  image: Image,
  video: Film,
  audio: Music,
  archive: FileArchive,
  pdf: FileText,
  text: FileText,
  document: FileText,
  other: File,
};

/* Tasteful tinting only: gold-ish for images, muted for every other file —
   semantic color is reserved for destructive actions. */
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

interface FileListProps {
  files: FileDTO[];
  onAction: (action: FileAction, file: FileDTO) => void;
}

export function FileList({ files, onAction }: FileListProps) {
  return (
    <ul className="grid gap-2">
      {files.map((file) => {
        const category = fileCategory(file.mimeType);
        const Icon = CATEGORY_ICONS[category];
        return (
          <li
            key={file.id}
            className="group flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:border-gold/40 hover:bg-bg-soft"
          >
            <Icon className={`h-5 w-5 shrink-0 ${CATEGORY_COLORS[category]}`} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium" title={file.name}>
              {file.name}
            </span>
            <span
              className="muted hidden w-48 shrink-0 truncate text-[12.5px] md:block"
              title={file.mimeType}
            >
              {file.mimeType}
            </span>
            <span className="muted hidden w-24 shrink-0 text-right text-[12.5px] lg:block">
              {formatDate(file.updatedAt)}
            </span>
            <span className="muted w-16 shrink-0 text-right text-[12.5px] tabular-nums">
              {formatBytes(file.size)}
            </span>
            <ItemMenu
              label={`Actions for file ${file.name}`}
              items={[
                {
                  label: "Rename",
                  icon: <Pencil className="h-4 w-4" aria-hidden="true" />,
                  onSelect: () => onAction("rename", file),
                },
                {
                  label: "Move",
                  icon: <FolderInput className="h-4 w-4" aria-hidden="true" />,
                  onSelect: () => onAction("move", file),
                },
                {
                  label: "Download",
                  icon: <Download className="h-4 w-4" aria-hidden="true" />,
                  onSelect: () => onAction("download", file),
                },
                {
                  label: "Delete",
                  icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
                  danger: true,
                  onSelect: () => onAction("delete", file),
                },
              ]}
            />
          </li>
        );
      })}
    </ul>
  );
}
