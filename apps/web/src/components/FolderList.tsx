import { Folder, FolderInput, Pencil, Trash2 } from "lucide-react";
import type { FolderDTO } from "@omnicloud/shared";
import { ItemMenu } from "./ItemMenu";
import type { MenuItem } from "./ItemMenu";

export type FolderAction = "rename" | "move" | "delete";

interface FolderListProps {
  folders: FolderDTO[];
  onOpen: (folder: FolderDTO) => void;
  onAction: (action: FolderAction, folder: FolderDTO) => void;
}

function buildMenuItems(
  folder: FolderDTO,
  onAction: (action: FolderAction, folder: FolderDTO) => void,
): MenuItem[] {
  return [
    {
      label: "Rename",
      icon: <Pencil className="h-4 w-4" aria-hidden="true" />,
      onSelect: () => onAction("rename", folder),
    },
    {
      label: "Move",
      icon: <FolderInput className="h-4 w-4" aria-hidden="true" />,
      onSelect: () => onAction("move", folder),
    },
    {
      label: "Delete",
      icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
      danger: true,
      onSelect: () => onAction("delete", folder),
    },
  ];
}

export function FolderList({ folders, onOpen, onAction }: FolderListProps) {
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {folders.map((folder) => (
        <li
          key={folder.id}
          className="group flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:border-gold/40 hover:bg-bg-soft"
        >
          <button
            type="button"
            onClick={() => onOpen(folder)}
            title={folder.name}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left"
          >
            <Folder className="h-5 w-5 shrink-0 text-gold" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{folder.name}</span>
          </button>
          <ItemMenu
            label={`Actions for folder ${folder.name}`}
            items={buildMenuItems(folder, onAction)}
          />
        </li>
      ))}
    </ul>
  );
}
