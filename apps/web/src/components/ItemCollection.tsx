import type { ReactNode } from "react";
import type { DriveItem, ViewMode } from "../lib/drive";
import type { SelectionController } from "../hooks/useSelection";
import { DriveItems } from "./DriveItems";
import type { ContextMenuState } from "./ContextMenu";
import type { ItemAction, MenuContext } from "./itemActions";

interface ItemCollectionProps {
  items: DriveItem[];
  view: ViewMode;
  selection: SelectionController;
  onOpen: (item: DriveItem) => void;
  onAction: (action: ItemAction, item: DriveItem) => void;
  onContextMenu: (menu: ContextMenuState) => void;
  menuContext?: MenuContext;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyState?: ReactNode;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

/**
 * Renders a drive section with consistent loading, error, empty and "Load more"
 * treatment around the shared list/grid renderer.
 */
export function ItemCollection({
  items,
  view,
  selection,
  onOpen,
  onAction,
  onContextMenu,
  menuContext,
  loading = false,
  error = null,
  onRetry,
  emptyState,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: ItemCollectionProps) {
  if (error !== null) {
    return (
      <div className="card mt-6 p-6 text-center">
        <p className="text-sm font-medium">Something went wrong.</p>
        <p className="muted mt-1 text-sm">{error}</p>
        {onRetry !== undefined ? (
          <button type="button" className="btn-secondary mt-4" onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </div>
    );
  }

  if (items.length === 0 && emptyState !== undefined) return <>{emptyState}</>;

  return (
    <>
      <DriveItems
        items={items}
        view={view}
        selection={selection}
        onOpen={onOpen}
        onAction={onAction}
        onContextMenu={onContextMenu}
        {...(menuContext !== undefined ? { menuContext } : {})}
        loading={loading}
      />
      {hasMore && onLoadMore !== undefined ? (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            className="btn-secondary"
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading..." : "Load more"}
          </button>
        </div>
      ) : null}
    </>
  );
}
