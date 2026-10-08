import {
  Download,
  FolderInput,
  Info,
  Pencil,
  RefreshCw,
  RotateCcw,
  Star,
  StarOff,
  Trash2,
} from "lucide-react";
import type { MenuItem } from "./ItemMenu";

/** Every action a drive item can expose, shared by menus and the selection bar. */
export type ItemAction =
  | "open"
  | "download"
  | "rename"
  | "move"
  | "star"
  | "unstar"
  | "replace"
  | "details"
  | "trash"
  | "restore"
  | "delete";

export type ItemActionHandler = (action: ItemAction, item: ItemRefLike) => void;

/** Minimal shape the action builders need (avoids importing the view model). */
export interface ItemRefLike {
  kind: "file" | "folder";
  id: string;
  name: string;
  starred: boolean;
  trashed: boolean;
}

export interface MenuContext {
  /** True on the Trash page. */
  trashed?: boolean;
  /** Show Restore/Delete instead of Trash. */
  onTrashPage?: boolean;
  /** Enables the "Replace" (new version) action (files only). */
  canReplace?: boolean;
}

/**
 * Builds the per-item action menu for the given context. Generic over the
 * concrete item type so callers can pass their richer view model (e.g.
 * DriveItem) and still receive it back in the handler.
 */
export function buildItemMenu<T extends ItemRefLike>(
  item: T,
  onAction: (action: ItemAction, item: T) => void,
  context: MenuContext = {},
): MenuItem[] {
  const isFile = item.kind === "file";
  const items: MenuItem[] = [];

  if (!item.trashed) {
    items.push({
      label: isFile ? "Download" : "Open",
      icon: isFile ? (
        <Download className="h-4 w-4" aria-hidden="true" />
      ) : (
        <FolderInput className="h-4 w-4" aria-hidden="true" />
      ),
      onSelect: () => onAction(isFile ? "download" : "open", item),
    });

    if (isFile) {
      items.push({
        label: "Details",
        icon: <Info className="h-4 w-4" aria-hidden="true" />,
        onSelect: () => onAction("details", item),
      });
    }

    items.push({
      label: "Rename",
      icon: <Pencil className="h-4 w-4" aria-hidden="true" />,
      onSelect: () => onAction("rename", item),
    });
    items.push({
      label: "Move",
      icon: <FolderInput className="h-4 w-4" aria-hidden="true" />,
      onSelect: () => onAction("move", item),
    });
    items.push({
      label: item.starred ? "Unstar" : "Star",
      icon: item.starred ? (
        <StarOff className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Star className="h-4 w-4" aria-hidden="true" />
      ),
      onSelect: () => onAction(item.starred ? "unstar" : "star", item),
    });

    if (isFile && context.canReplace === true) {
      items.push({
        label: "Upload new version",
        icon: <RefreshCw className="h-4 w-4" aria-hidden="true" />,
        onSelect: () => onAction("replace", item),
      });
    }

    items.push({
      label: "Move to trash",
      icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
      danger: true,
      onSelect: () => onAction("trash", item),
    });
  } else {
    items.push({
      label: "Restore",
      icon: <RotateCcw className="h-4 w-4" aria-hidden="true" />,
      onSelect: () => onAction("restore", item),
    });
    items.push({
      label: "Delete permanently",
      icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
      danger: true,
      onSelect: () => onAction("delete", item),
    });
  }

  return items;
}
