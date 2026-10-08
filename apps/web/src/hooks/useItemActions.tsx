import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { BatchOperation } from "../api/client";
import { api, errorMessage } from "../api/client";
import { invalidateDriveQueries } from "../lib/queries";
import type { DriveItem } from "../lib/drive";
import { useToast } from "../components/Toasts";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DeleteFolderDialog } from "../components/DeleteFolderDialog";
import { MoveDialog } from "../components/MoveDialog";
import { NameDialog } from "../components/NameDialog";
import { buildFolderTree } from "../lib/tree";
import { useQuery } from "@tanstack/react-query";
import { TREE_QUERY_KEY } from "../lib/queries";
import type { ItemAction } from "../components/itemActions";

interface UseItemActionsOptions {
  /** Navigate into a folder (used by the "Open" action). */
  onOpenItem: (item: DriveItem) => void;
  /** Show the details slide-over. */
  onShowDetails: (item: DriveItem) => void;
  /** Route a "new version" upload through the shared uploads panel. */
  onReplaceFile: (file: File, fileId: string) => void;
}

export interface ItemActionsController {
  handleAction: (action: ItemAction, item: DriveItem) => void;
  openMove: (items: DriveItem[]) => void;
  requestDelete: (items: DriveItem[]) => void;
  runBatch: (operation: BatchOperation, items: DriveItem[], folderId?: string | null) => void;
  pendingBatch: boolean;
  dialogs: ReactNode;
}

function itemLabel(items: DriveItem[]): string {
  const first = items[0];
  if (items.length === 1 && first !== undefined) return `"${first.name}"`;
  return `${items.length} items`;
}

/**
 * Central action dispatcher for file/folder items across every section: rename,
 * move, star, trash/restore/delete (single and batch), replace and details.
 * Owns the dialogs they require so pages only wire the item list.
 */
export function useItemActions({
  onOpenItem,
  onShowDetails,
  onReplaceFile,
}: UseItemActionsOptions): ItemActionsController {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [renaming, setRenaming] = useState<DriveItem | null>(null);
  const [moving, setMoving] = useState<DriveItem[] | null>(null);
  const [deleting, setDeleting] = useState<DriveItem[] | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<DriveItem | null>(null);
  const replaceInput = useRef<HTMLInputElement | null>(null);
  const replaceTarget = useRef<DriveItem | null>(null);

  const treeQuery = useQuery({ queryKey: TREE_QUERY_KEY, queryFn: api.folders.tree });

  const finish = useCallback(
    (message: string) => {
      invalidateDriveQueries(queryClient);
      toast.success(message);
    },
    [queryClient, toast],
  );

  const renameMutation = useMutation({
    // Returns a normalized shape so both branches share one mutation type.
    mutationFn: async (variables: { item: DriveItem; name: string }): Promise<{ name: string }> => {
      if (variables.item.kind === "file") {
        const { file } = await api.files.update(variables.item.id, { name: variables.name });
        return { name: file.name };
      }
      const { folder } = await api.folders.update(variables.item.id, { name: variables.name });
      return { name: folder.name };
    },
    onSuccess: (_result, variables) => {
      setRenaming(null);
      finish(`Renamed to "${variables.name}"`);
    },
    onError: (error) => toast.error(errorMessage(error, "Could not rename item")),
  });

  const batchMutation = useMutation({
    mutationFn: async (variables: {
      operation: BatchOperation;
      items: DriveItem[];
      folderId?: string | null;
    }) => {
      const fileIds: string[] = [];
      const folderIds: string[] = [];
      for (const item of variables.items) {
        if (item.kind === "file") fileIds.push(item.id);
        else folderIds.push(item.id);
      }
      const results = [];
      if (fileIds.length > 0) {
        results.push(
          await api.files.batch({
            operation: variables.operation,
            ids: fileIds,
            ...(variables.folderId !== undefined ? { folderId: variables.folderId } : {}),
          }),
        );
      }
      if (folderIds.length > 0) {
        results.push(
          await api.folders.batch({
            operation: variables.operation,
            ids: folderIds,
            ...(variables.folderId !== undefined ? { folderId: variables.folderId } : {}),
          }),
        );
      }
      return results.reduce(
        (acc, result) => ({
          requested: acc.requested + result.requested,
          succeeded: acc.succeeded + result.succeeded,
          failed: acc.failed + result.failed,
        }),
        { requested: 0, succeeded: 0, failed: 0 },
      );
    },
    onSuccess: (result, variables) => {
      invalidateDriveQueries(queryClient);
      const label = itemLabel(variables.items);
      if (result.failed > 0) {
        toast.error(
          `${result.succeeded} of ${result.requested} succeeded — ${result.failed} failed`,
        );
      } else {
        toast.success(`Updated ${label}`);
      }
      setDeleting(null);
      setMoving(null);
    },
    onError: (error) => toast.error(errorMessage(error, "The operation failed")),
  });

  const openMove = useCallback((items: DriveItem[]) => {
    if (items.length > 0) setMoving(items);
  }, []);

  const requestDelete = useCallback((items: DriveItem[]) => {
    if (items.length === 0) return;
    const single = items.length === 1 ? items[0] : undefined;
    if (single !== undefined && single.kind === "folder") {
      setDeletingFolder(single);
      return;
    }
    setDeleting(items);
  }, []);

  const runBatch = useCallback(
    (operation: BatchOperation, items: DriveItem[], folderId?: string | null) => {
      if (items.length === 0) return;
      batchMutation.mutate({ operation, items, ...(folderId !== undefined ? { folderId } : {}) });
    },
    [batchMutation],
  );

  const openReplacePicker = useCallback((item: DriveItem) => {
    replaceTarget.current = item;
    replaceInput.current?.click();
  }, []);

  const handleAction = useCallback(
    (action: ItemAction, item: DriveItem) => {
      switch (action) {
        case "open":
          onOpenItem(item);
          return;
        case "download":
          if (item.kind === "file") api.files.download(item.id);
          return;
        case "rename":
          setRenaming(item);
          return;
        case "move":
          openMove([item]);
          return;
        case "star":
          runBatch("star", [item]);
          return;
        case "unstar":
          runBatch("unstar", [item]);
          return;
        case "replace":
          openReplacePicker(item);
          return;
        case "details":
          onShowDetails(item);
          return;
        case "trash":
          runBatch("trash", [item]);
          return;
        case "restore":
          runBatch("restore", [item]);
          return;
        case "delete":
          requestDelete([item]);
          return;
        default:
          return;
      }
    },
    [onOpenItem, onShowDetails, openMove, openReplacePicker, requestDelete, runBatch],
  );

  const tree = buildFolderTree(treeQuery.data?.folders ?? []);
  const deleteName = deleting !== null ? itemLabel(deleting) : "";

  const dialogs = (
    <>
      <input
        ref={replaceInput}
        type="file"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          const input = event.currentTarget;
          const file = input.files?.[0];
          const target = replaceTarget.current;
          input.value = "";
          if (file !== undefined && target !== null) onReplaceFile(file, target.id);
          replaceTarget.current = null;
        }}
      />

      {renaming !== null ? (
        <NameDialog
          title={renaming.kind === "file" ? "Rename file" : "Rename folder"}
          label="Name"
          confirmLabel="Rename"
          initialValue={renaming.name}
          pending={renameMutation.isPending}
          onSubmit={(name) => renameMutation.mutate({ item: renaming, name })}
          onClose={() => setRenaming(null)}
        />
      ) : null}

      {moving !== null ? <MoveDialog targets={moving} onClose={() => setMoving(null)} /> : null}

      {deletingFolder !== null && deletingFolder.folder !== null ? (
        <DeleteFolderDialog
          folder={deletingFolder.folder}
          tree={tree}
          onClose={() => setDeletingFolder(null)}
        />
      ) : null}

      {deleting !== null ? (
        <ConfirmDialog
          title={`Delete ${deleteName}?`}
          message={`This will permanently delete ${deleteName}. This action cannot be undone.`}
          confirmLabel="Delete permanently"
          destructive
          busy={batchMutation.isPending}
          onConfirm={() => runBatch("delete", deleting)}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </>
  );

  return {
    handleAction,
    openMove,
    requestDelete,
    runBatch,
    pendingBatch: batchMutation.isPending,
    dialogs,
  };
}
