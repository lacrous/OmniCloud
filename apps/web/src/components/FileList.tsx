import type { FileDTO } from "@omnicloud/shared";
import type { FileCategory } from "@omnicloud/shared";
import { fileCategory } from "@omnicloud/shared";
import { formatBytes, formatDate } from "../lib/format";
import { DownloadIcon, FileIcon, MoveIcon, PencilIcon, TrashIcon } from "./icons";
import { ItemMenu } from "./ItemMenu";

export type FileAction = "rename" | "move" | "download" | "delete";

const CATEGORY_COLORS: Record<FileCategory, string> = {
  image: "text-emerald-600",
  video: "text-pink-600",
  audio: "text-amber-600",
  pdf: "text-red-600",
  archive: "text-orange-600",
  document: "text-blue-600",
  text: "text-sky-600",
  other: "text-gray-500",
};

interface FileListProps {
  files: FileDTO[];
  onAction: (action: FileAction, file: FileDTO) => void;
}

export function FileList({ files, onAction }: FileListProps) {
  return (
    <ul className="oc-card divide-y divide-gray-100">
      {files.map((file) => {
        const category = fileCategory(file.mimeType);
        return (
          <li
            key={file.id}
            className="flex items-center gap-3 px-3 py-2.5 transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-gray-50"
          >
            <FileIcon
              category={category}
              className={`h-5 w-5 shrink-0 ${CATEGORY_COLORS[category]}`}
            />
            <span
              className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900"
              title={file.name}
            >
              {file.name}
            </span>
            <span
              className="hidden w-48 shrink-0 truncate text-xs text-gray-400 md:block"
              title={file.mimeType}
            >
              {file.mimeType}
            </span>
            <span className="hidden w-24 shrink-0 text-right text-xs text-gray-500 lg:block">
              {formatDate(file.updatedAt)}
            </span>
            <span className="w-16 shrink-0 text-right text-xs text-gray-500 tabular-nums">
              {formatBytes(file.size)}
            </span>
            <ItemMenu
              label={`Actions for file ${file.name}`}
              items={[
                {
                  label: "Rename",
                  icon: <PencilIcon className="h-4 w-4" />,
                  onSelect: () => onAction("rename", file),
                },
                {
                  label: "Move",
                  icon: <MoveIcon className="h-4 w-4" />,
                  onSelect: () => onAction("move", file),
                },
                {
                  label: "Download",
                  icon: <DownloadIcon className="h-4 w-4" />,
                  onSelect: () => onAction("download", file),
                },
                {
                  label: "Delete",
                  icon: <TrashIcon className="h-4 w-4" />,
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
