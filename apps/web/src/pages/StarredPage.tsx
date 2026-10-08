import { Star, StarOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../api/client";
import { fileToItem, folderToItem, isViewMode, itemKeyOf } from "../lib/drive";
import type { DriveItem, ViewMode } from "../lib/drive";
import { useInfiniteList } from "../hooks/useInfiniteList";
import { useItemActions } from "../hooks/useItemActions";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { usePageShortcuts } from "../hooks/usePageShortcuts";
import { useSelection } from "../hooks/useSelection";
import { useDriveShell } from "../hooks/useDriveShell";
import { useNavigate } from "react-router-dom";
import { ContextMenu } from "../components/ContextMenu";
import type { ContextMenuState } from "../components/ContextMenu";
import { DetailsPanel } from "../components/DetailsPanel";
import { EmptyState } from "../components/EmptyState";
import { ItemCollection } from "../components/ItemCollection";
import { PageHeader, PageTitle } from "../components/PageHeader";
import { SelectionBar } from "../components/SelectionBar";
import { ViewToggle } from "../components/ViewToggle";

const PAGE_LIMIT = 100;

export default function StarredPage() {
  const { uploads } = useDriveShell();
  const navigate = useNavigate();

  const [view, setView] = useLocalStorage<ViewMode>("omnicloud-view", "list", isViewMode);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [detailsItem, setDetailsItem] = useState<DriveItem | null>(null);
  const selection = useSelection();

  const starred = useInfiniteList({
    queryKey: ["starred"],
    queryFn: (page) =>
      api.starred.list({ page, limit: PAGE_LIMIT, status: "active" }).then((result) => ({
        items: [...result.folders.map(folderToItem), ...result.files.map(fileToItem)],
        pagination: result.pagination,
      })),
  });

  const items = starred.items;
  const validKeys = useMemo(() => items.map(itemKeyOf), [items]);
  useEffect(() => {
    selection.prune(validKeys);
  }, [validKeys, selection]);

  const actions = useItemActions({
    onOpenItem: (item) => {
      if (item.kind === "folder") navigate(`/?folder=${encodeURIComponent(item.id)}`);
      else api.files.download(item.id);
    },
    onShowDetails: setDetailsItem,
    onReplaceFile: uploads.replace,
  });

  const selectedItems = useMemo(
    () => items.filter((item) => selection.isSelected(itemKeyOf(item))),
    [items, selection],
  );

  usePageShortcuts({
    onDelete: () => actions.runBatch("trash", selectedItems),
    onSelectAll: () => selection.selectAll(validKeys),
    onEscape: () => setDetailsItem(null),
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
      <PageHeader
        title={
          <div>
            <PageTitle>Starred</PageTitle>
            <p className="muted mt-1 text-[13px]">Files and folders you marked for quick access.</p>
          </div>
        }
        actions={<ViewToggle view={view} onChange={setView} />}
      />

      <div className="mt-5">
        <ItemCollection
          items={items}
          view={view}
          selection={selection}
          onOpen={(item) =>
            actions.handleAction(item.kind === "folder" ? "open" : "download", item)
          }
          onAction={actions.handleAction}
          onContextMenu={setContextMenu}
          loading={starred.isLoading}
          error={
            starred.isError ? errorMessage(starred.error, "Could not load starred items.") : null
          }
          onRetry={starred.refetch}
          hasMore={starred.hasMore}
          loadingMore={starred.isLoadingMore}
          onLoadMore={starred.loadMore}
          emptyState={
            <EmptyState
              icon={Star}
              title="No starred items"
              description="Star files and folders from My Drive to find them here."
            />
          }
        />
      </div>

      <SelectionBar
        count={selection.count}
        onClear={selection.clear}
        onSelectAll={() => selection.selectAll(validKeys)}
      >
        <button
          type="button"
          className="btn-secondary"
          onClick={() => actions.runBatch("unstar", selectedItems)}
        >
          <StarOff className="h-4 w-4" aria-hidden="true" />
          Unstar
        </button>
      </SelectionBar>

      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
      <DetailsPanel
        item={detailsItem}
        onClose={() => setDetailsItem(null)}
        onAction={actions.handleAction}
      />
      {actions.dialogs}
    </div>
  );
}
