import { Folder, Star } from "lucide-react";
import type { MouseEvent } from "react";
import { formatBytes, formatDate, formatRelative } from "../lib/format";
import { fileVisual } from "../lib/fileIcons";
import { itemKeyOf, itemRef } from "../lib/drive";
import type { DriveItem, ViewMode } from "../lib/drive";
import type { SelectionController } from "../hooks/useSelection";
import type { ContextMenuState } from "./ContextMenu";
import { ItemMenu } from "./ItemMenu";
import { FileThumb } from "./FileThumb";
import { SelectCheckbox } from "./SelectCheckbox";
import { buildItemMenu } from "./itemActions";
import type { ItemAction, MenuContext } from "./itemActions";

interface DriveItemsProps {
  items: DriveItem[];
  view: ViewMode;
  selection: SelectionController;
  onOpen: (item: DriveItem) => void;
  onAction: (action: ItemAction, item: DriveItem) => void;
  onContextMenu: (menu: ContextMenuState) => void;
  menuContext?: MenuContext;
  loading?: boolean;
}

function ItemIcon({ item }: { item: DriveItem }) {
  if (item.kind === "folder") {
    return <Folder className="h-5 w-5 shrink-0 text-gold" aria-hidden="true" />;
  }
  const { Icon, color } = fileVisual(item.mimeType);
  return <Icon className={`h-5 w-5 shrink-0 ${color}`} aria-hidden="true" />;
}

/** Loading skeleton rows/cards for the current view. */
function Skeleton({ view }: { view: ViewMode }) {
  const rows = [0, 1, 2, 3, 4];
  if (view === "grid") {
    return (
      <div aria-hidden="true" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {rows.map((row) => (
          <div key={row} className="card h-40 animate-pulse bg-bg-soft" />
        ))}
      </div>
    );
  }
  return (
    <div aria-hidden="true" className="grid gap-2">
      {rows.map((row) => (
        <div key={row} className="h-14 animate-pulse rounded-xl border border-line bg-bg-soft" />
      ))}
    </div>
  );
}

export function DriveItems({
  items,
  view,
  selection,
  onOpen,
  onAction,
  onContextMenu,
  menuContext = {},
  loading = false,
}: DriveItemsProps) {
  const orderedKeys = items.map(itemKeyOf);

  const handleActivate = (
    event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean },
    item: DriveItem,
  ) => {
    if (event.metaKey || event.ctrlKey) {
      selection.toggle(itemRef(item));
      return;
    }
    if (event.shiftKey) {
      selection.toggle(itemRef(item), { orderedKeys, range: true });
      return;
    }
    onOpen(item);
  };

  const openContextMenu = (event: MouseEvent, item: DriveItem) => {
    event.preventDefault();
    onContextMenu({
      x: event.clientX,
      y: event.clientY,
      label: `Actions for ${item.name}`,
      items: buildItemMenu(item, onAction, menuContext),
    });
  };

  if (loading) return <Skeleton view={view} />;
  if (items.length === 0) return null;

  if (view === "grid") {
    return (
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {items.map((item, index) => {
          const selected = selection.isSelected(itemKeyOf(item));
          return (
            <li
              key={itemKeyOf(item)}
              onClick={(event) => handleActivate(event, item)}
              onContextMenu={(event) => openContextMenu(event, item)}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  handleActivate(event, item);
                }
              }}
              style={{ animationDelay: `${Math.min(index, 12) * 24}ms` }}
              className={`drive-item drive-item-card drive-card-enter group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-surface outline-none focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/35 ${
                selected
                  ? "border-gold bg-gold-soft"
                  : "border-line hover:border-gold/45 hover:bg-bg-soft"
              } ${item.trashed ? "opacity-70" : ""}`}
            >
              <div className="relative">
                <div className="drive-media rounded-b-none">
                  <FileThumb item={item}>
                    <span className="grid h-16 w-16 place-items-center rounded-2xl bg-surface/70 backdrop-blur-sm">
                      {item.kind === "folder" ? (
                        <Folder className="h-9 w-9 text-gold" aria-hidden="true" />
                      ) : (
                        (() => {
                          const { Icon, color } = fileVisual(item.mimeType);
                          return <Icon className={`h-9 w-9 ${color}`} aria-hidden="true" />;
                        })()
                      )}
                    </span>
                  </FileThumb>
                </div>
                <div
                  className="absolute top-2.5 left-2.5"
                  onClick={(event) => event.stopPropagation()}
                >
                  <SelectCheckbox
                    checked={selected}
                    visible={selected || selection.count > 0}
                    label={`Select ${item.name}`}
                    onToggle={(event) =>
                      selection.toggle(itemRef(item), { orderedKeys, range: event.shiftKey })
                    }
                  />
                </div>
                <div
                  className="absolute top-2 right-2"
                  onClick={(event) => event.stopPropagation()}
                >
                  <ItemMenu
                    label={`Actions for ${item.name}`}
                    items={buildItemMenu(item, onAction, menuContext)}
                  />
                </div>
                {item.file?.encryptionFormat === "OCE1" ? (
                  <span
                    className="absolute right-2 bottom-2 rounded-full border border-line bg-surface/80 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted uppercase backdrop-blur-sm"
                    title="End-to-end encrypted"
                  >
                    Encrypted
                  </span>
                ) : null}
              </div>
              <div className="min-w-0 px-3.5 py-3">
                <p className="line-clamp-2 text-[13px] leading-snug font-medium" title={item.name}>
                  {item.starred ? (
                    <Star
                      className="mr-1 inline h-3 w-3 -translate-y-px text-gold"
                      aria-hidden="true"
                    />
                  ) : null}
                  {item.name}
                </p>
                <p className="muted mt-1 truncate text-[12px]">
                  {item.kind === "folder"
                    ? "Folder"
                    : `${formatBytes(item.size)} · ${fileVisual(item.mimeType).label}`}
                </p>
                {item.deletedAt !== null ? (
                  <p className="muted mt-0.5 text-[11px]">
                    Deleted {formatRelative(item.deletedAt)}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul className="grid gap-1.5">
      {items.map((item) => {
        const selected = selection.isSelected(itemKeyOf(item));
        return (
          <li
            key={itemKeyOf(item)}
            onClick={(event) => handleActivate(event, item)}
            onContextMenu={(event) => openContextMenu(event, item)}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleActivate(event, item);
              }
            }}
            className={`drive-item group flex cursor-pointer items-center gap-3 rounded-xl border bg-surface px-3 py-3 outline-none focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/35 sm:px-4 ${
              selected
                ? "border-gold bg-gold-soft"
                : "border-line hover:border-gold/45 hover:bg-bg-soft hover:shadow-[var(--shadow)]"
            } ${item.trashed ? "opacity-70" : ""}`}
          >
            <div onClick={(event) => event.stopPropagation()}>
              <SelectCheckbox
                checked={selected}
                visible={selected || selection.count > 0}
                label={`Select ${item.name}`}
                onToggle={(event) =>
                  selection.toggle(itemRef(item), { orderedKeys, range: event.shiftKey })
                }
              />
            </div>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-bg-soft/85">
              <ItemIcon item={item} />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium" title={item.name}>
              {item.starred ? (
                <Star
                  className="mr-1.5 inline h-3.5 w-3.5 -translate-y-px text-gold"
                  aria-hidden="true"
                />
              ) : null}
              {item.name}
            </span>
            {item.file?.encryptionFormat === "OCE1" ? (
              <span className="shrink-0 rounded-full border border-line bg-bg-soft px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted uppercase">
                Encrypted
              </span>
            ) : null}
            {item.deletedAt !== null ? (
              <span className="muted hidden shrink-0 text-[12px] sm:block">
                Deleted {formatRelative(item.deletedAt)}
              </span>
            ) : null}
            <span className="muted hidden w-40 shrink-0 truncate text-[12.5px] md:block">
              {item.kind === "folder" ? "Folder" : fileVisual(item.mimeType).label}
            </span>
            <span className="muted hidden w-28 shrink-0 text-right text-[12.5px] lg:block">
              {formatDate(item.updatedAt)}
            </span>
            <span className="muted w-16 shrink-0 text-right text-[12.5px] tabular-nums">
              {item.kind === "folder" ? "—" : formatBytes(item.size)}
            </span>
            <div onClick={(event) => event.stopPropagation()}>
              <ItemMenu
                label={`Actions for ${item.name}`}
                items={buildItemMenu(item, onAction, menuContext)}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
