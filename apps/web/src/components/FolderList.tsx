import type { FolderDTO } from "@omnicloud/shared";
import { FolderIcon, MoveIcon, PencilIcon, TrashIcon } from "./icons";
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
      icon: <PencilIcon className="h-4 w-4" />,
      onSelect: () => onAction("rename", folder),
    },
    {
      label: "Move",
      icon: <MoveIcon className="h-4 w-4" />,
      onSelect: () => onAction("move", folder),
    },
    {
      label: "Delete",
      icon: <TrashIcon className="h-4 w-4" />,
      danger: true,
      onSelect: () => onAction("delete", folder),
    },
  ];
}

export function FolderList({ folders, onOpen, onAction }: FolderListProps) {
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {folders.map((folder) => (
        <li
          key={folder.id}
          className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-2 pr-1 transition-colors hover:bg-gray-50"
        >
          <button
            type="button"
            onClick={() => onOpen(folder)}
            title={folder.name}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 py-0.5 text-left focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none"
          >
            <FolderIcon className="h-7 w-7 shrink-0 text-indigo-500" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
              {folder.name}
            </span>
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
