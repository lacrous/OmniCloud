import {
  Download,
  Eye,
  EyeOff,
  FolderInput,
  Info,
  LockKeyhole,
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
  | "preview"
  | "rename"
  | "move"
  | "star"
  | "unstar"
  | "replace"
  | "migrate"
  | "hideName"
  | "details"
  | "trash"
  | "restore"
  | "delete";

/** Minimal shape the action builders need (avoids importing the view model). */
export interface ItemRefLike {
  kind: "file" | "folder";
  id: string;
  name: string;
  starred: boolean;
  trashed: boolean;
  /** Present on file items; null/undefined encryptionFormat = legacy plaintext. */
  file?: { encryptionFormat?: string | null } | null;
}

export interface MenuContext {
  /** True on the Trash page. */
  trashed?: boolean;
  /** Show Restore/Delete instead of Trash. */
  onTrashPage?: boolean;
  /** Enables the "Replace" (new version) action (files only). */
  canReplace?: boolean;
}

const PREVIEWABLE_EXTENSIONS = /\.(png|jpe?g|gif|webp|avif|bmp|svg|mp4|webm|ogv|mov|m4v)$/i;

/**
 * Whether an item can be previewed in the browser.
 *
 * Only end-to-end encrypted files qualify: previews decrypt in-tab, and legacy
 * plaintext files keep the server's own download path so this feature never
 * becomes a way to render an unverified file. Extension matching uses the
 * server-side name; the decrypted name is used once the bytes are in hand.
 */
export function isPreviewableEncryptedFile(item: ItemRefLike): boolean {
  if (item.kind !== "file") return false;
  if ((item.file?.encryptionFormat ?? null) === null) return false;
  return PREVIEWABLE_EXTENSIONS.test(item.name);
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
      // Preview is offered only for encrypted files whose type can be shown
      // in-tab. Legacy plaintext files and other types keep Download only.
      if (isPreviewableEncryptedFile(item)) {
        items.push({
          label: "Preview",
          icon: <Eye className="h-4 w-4" aria-hidden="true" />,
          onSelect: () => onAction("preview", item),
        });
      }
      items.push({
        label: "Details",
        icon: <Info className="h-4 w-4" aria-hidden="true" />,
        onSelect: () => onAction("details", item),
      });
      // An encrypted file whose name the server still knows can be moved to an
      // opaque name, so the server stops seeing it.
      if (item.file?.encryptionFormat === "OCE1") {
        items.push({
          label: "Hide the name",
          icon: <EyeOff className="h-4 w-4" aria-hidden="true" />,
          onSelect: () => onAction("hideName", item),
        });
      }
      if ((item.file?.encryptionFormat ?? null) === null) {
        items.push({
          label: "Encrypt file",
          icon: <LockKeyhole className="h-4 w-4" aria-hidden="true" />,
          onSelect: () => onAction("migrate", item),
        });
      }
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
