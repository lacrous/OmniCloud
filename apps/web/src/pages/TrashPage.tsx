import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { api, errorMessage } from "../api/client";
import { plural } from "../lib/format";
import { fileToItem, folderToItem, isViewMode, itemKeyOf } from "../lib/drive";
import type { DriveItem, ViewMode } from "../lib/drive";
import { invalidateDriveQueries } from "../lib/queries";
import { useInfiniteList } from "../hooks/useInfiniteList";
import { useItemActions } from "../hooks/useItemActions";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { usePageShortcuts } from "../hooks/usePageShortcuts";
import { useSelection } from "../hooks/useSelection";
import { useDriveShell } from "../hooks/useDriveShell";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ContextMenu } from "../components/ContextMenu";
import type { ContextMenuState } from "../components/ContextMenu";
import { DetailsPanel } from "../components/DetailsPanel";
import { EmptyState } from "../components/EmptyState";
import { ItemCollection } from "../components/ItemCollection";
import { PageHeader, PageTitle } from "../components/PageHeader";
import { SelectionBar } from "../components/SelectionBar";
import { ViewToggle } from "../components/ViewToggle";
import { useToast } from "../components/Toasts";
import { useEffect } from "react";

const PAGE_LIMIT = 100;

export default function TrashPage() {
  const { uploads } = useDriveShell();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [view, setView] = useLocalStorage<ViewMode>("omnicloud-view", "list", isViewMode);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [detailsItem, setDetailsItem] = useState<DriveItem | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const selection = useSelection();

  const trash = useInfiniteList({
    queryKey: ["trash"],
    queryFn: (page) =>
      api.trash.list({ page, limit: PAGE_LIMIT }).then((result) => {
        const items = [...result.folders.map(folderToItem), ...result.files.map(fileToItem)];
        return { items, pagination: result.pagination };
      }),
  });

  const items = trash.items;
  const validKeys = useMemo(() => items.map(itemKeyOf), [items]);
  useEffect(() => {
    selection.prune(validKeys);
  }, [validKeys, selection]);

  const actions = useItemActions({
    onOpenItem: () => undefined,
    onShowDetails: setDetailsItem,
    onReplaceFile: uploads.replace,
  });

  const selectedItems = useMemo(
    () => items.filter((item) => selection.isSelected(itemKeyOf(item))),
    [items, selection],
  );

  const emptyMutation = useMutation({
    mutationFn: api.trash.empty,
    onSuccess: (result) => {
      invalidateDriveQueries(queryClient);
      setConfirmEmpty(false);
      toast.success(
        `Emptied trash: ${plural(result.deletedFiles, "file")}, ${plural(result.deletedFolders, "folder")}` +
          (result.failedFiles > 0 ? `, ${result.failedFiles} failed` : ""),
      );
    },
    onError: (error) => toast.error(errorMessage(error, "Could not empty the trash")),
  });

  usePageShortcuts({
    onDelete: () => actions.requestDelete(selectedItems),
    onSelectAll: () => selection.selectAll(validKeys),
    onEscape: () => setDetailsItem(null),
  });

  const clearSelectionAfter = useCallback(
    (run: () => void) => {
      run();
      selection.clear();
    },
    [selection],
  );

  const emptyState = (
    <EmptyState
      icon={Trash2}
      title="Trash is empty"
      description="Items you move to the trash will show up here until you delete them permanently."
    />
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
      <PageHeader
        title={
          <div>
            <PageTitle>Trash</PageTitle>
            <p className="muted mt-1 text-[13px]">
              Items here keep counting toward nothing until you empty the trash.
            </p>
          </div>
        }
        actions={
          <>
            <ViewToggle view={view} onChange={setView} />
            <button
              type="button"
              className="btn-danger"
              onClick={() => setConfirmEmpty(true)}
              disabled={items.length === 0}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Empty trash
            </button>
          </>
        }
      />

      <div className="mt-5">
        <ItemCollection
          items={items}
          view={view}
          selection={selection}
          onOpen={(item) => setDetailsItem(item)}
          onAction={actions.handleAction}
          onContextMenu={setContextMenu}
          menuContext={{ trashed: true, onTrashPage: true }}
          loading={trash.isLoading}
          error={trash.isError ? errorMessage(trash.error, "Could not load the trash.") : null}
          onRetry={trash.refetch}
          hasMore={trash.hasMore}
          loadingMore={trash.isLoadingMore}
          onLoadMore={trash.loadMore}
          emptyState={emptyState}
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
          onClick={() => clearSelectionAfter(() => actions.runBatch("restore", selectedItems))}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Restore
        </button>
        <button
          type="button"
          className="btn-danger"
          onClick={() => actions.requestDelete(selectedItems)}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Delete permanently
        </button>
      </SelectionBar>

      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
      <DetailsPanel
        item={detailsItem}
        onClose={() => setDetailsItem(null)}
        onAction={actions.handleAction}
      />
      {actions.dialogs}

      {confirmEmpty ? (
        <ConfirmDialog
          title="Empty the trash?"
          message="Every item in the trash will be permanently deleted. This action cannot be undone."
          confirmLabel="Empty trash"
          destructive
          busy={emptyMutation.isPending}
          onConfirm={() => emptyMutation.mutate()}
          onClose={() => setConfirmEmpty(false)}
        />
      ) : null}
    </div>
  );
}
