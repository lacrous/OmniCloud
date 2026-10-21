import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { BatchOperation } from "../api/client";
import { api, errorMessage } from "../api/client";
import { downloadFile } from "../api/download";
import { migrateLegacyFile } from "../api/migration";
import { invalidateDriveQueries } from "../lib/queries";
import { getUrk } from "../lib/crypto-session";
import type { DriveItem } from "../lib/drive";
import { useToast } from "../components/Toasts";
import { useNameIndex } from "./useNameIndex";
import { renamedMetadataBlob, serverSideNameFor } from "../lib/rename-metadata";
import { migrateToOpaqueName } from "../api/migration";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DeleteFolderDialog } from "../components/DeleteFolderDialog";
import { FilePreview } from "../components/FilePreview";
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
  /** Encrypts the legacy (plaintext) files among the given items, sequentially. */
  migrateBatch: (items: DriveItem[]) => void;
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
  const nameIndex = useNameIndex();

  const [renaming, setRenaming] = useState<DriveItem | null>(null);
  const [moving, setMoving] = useState<DriveItem[] | null>(null);
  const [deleting, setDeleting] = useState<DriveItem[] | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<DriveItem | null>(null);
  const [migrating, setMigrating] = useState<DriveItem[] | null>(null);
  const [previewing, setPreviewing] = useState<DriveItem | null>(null);
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
        // A file whose name the server cannot read keeps the placeholder it
        // already has: sending the real name back would undo the point. Only
        // the encrypted metadata changes.
        await api.files.update(variables.item.id, {
          name: serverSideNameFor(variables.item, variables.name),
          ...(await renamedMetadataBlob(variables.item, variables.name)),
        });
        return { name: variables.name };
      }
      const { folder } = await api.folders.update(variables.item.id, { name: variables.name });
      return { name: folder.name };
    },
    onSuccess: (_result, variables) => {
      setRenaming(null);
      // A file stored as OCE2 has its name in the client's index, so the entry
      // has to follow the rename.
      if (variables.item.kind === "file" && variables.item.file?.encryptionFormat === "OCE2") {
        const entry = nameIndex.entries.get(variables.item.id);
        if (entry !== undefined) {
          nameIndex.upsert({ ...entry, name: variables.name });
        }
      }
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
      // A permanently deleted file is gone from the server, so its entry in the
      // client's index has to go too.
      if (variables.operation === "delete") {
        for (const item of variables.items) {
          if (item.kind === "file") nameIndex.remove(item.id);
        }
      }
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

  // Sequential legacy migration: each file encrypt → replace → verify → prune
  // runs to completion before the next starts, so failures stay attributable.
  const migrateMutation = useMutation({
    mutationFn: async (items: DriveItem[]) => {
      const urk = getUrk();
      if (urk === null) {
        throw new Error("Generate or unlock an encryption key first");
      }
      let migrated = 0;
      let already = 0;
      let remaining = 0;
      let failed = 0;
      let firstError: unknown = null;
      for (const item of items) {
        try {
          const result = await migrateLegacyFile(item.id, urk);
          if (result.status === "already_migrated") already += 1;
          else {
            migrated += 1;
            remaining += result.plaintextVersionsRemaining;
          }
        } catch (error) {
          failed += 1;
          if (firstError === null) firstError = error;
        }
      }
      return { migrated, already, remaining, failed, firstError };
    },
    onSuccess: (result, items) => {
      setMigrating(null);
      invalidateDriveQueries(queryClient);
      if (result.migrated === 0 && result.already === 0 && result.failed > 0) {
        toast.error(errorMessage(result.firstError, "Could not encrypt the file"));
      } else if (result.failed > 0) {
        toast.error(
          `Encrypted ${result.migrated}, ${result.failed} failed — failed files kept their plaintext copy`,
        );
      } else if (items.length === 1 && result.already === 1) {
        toast.success("File is already encrypted");
      } else if (result.remaining > 0) {
        toast.success(
          `Encrypted ${result.migrated} file(s) — ${result.remaining} older plaintext version(s) remain`,
        );
      } else {
        toast.success(
          result.migrated === 1
            ? `Encrypted "${items[0]?.name ?? "file"}" — plaintext copy removed after verification`
            : `Encrypted ${result.migrated} file(s)`,
        );
      }
    },
    onError: (error) => {
      setMigrating(null);
      toast.error(errorMessage(error, "Could not encrypt"));
    },
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

  const migrateBatch = useCallback(
    (items: DriveItem[]) => {
      const legacy = items.filter(
        (item) =>
          item.kind === "file" && !item.trashed && (item.file?.encryptionFormat ?? null) === null,
      );
      if (legacy.length === 0) return;
      if (getUrk() === null) {
        toast.error("Generate or unlock an encryption key first");
        return;
      }
      setMigrating(legacy);
    },
    [toast],
  );

  /**
   * Moves encrypted files to a name the server cannot read.
   *
   * The new version is downloaded back and compared with the original before
   * the old one is removed, so a failure leaves the file as it was. The index
   * is updated with the real name, which is now only known here.
   */
  const hideName = useCallback(
    async (items: DriveItem[]) => {
      const urk = getUrk();
      if (urk === null) {
        toast.error("Generate or unlock your encryption key first");
        return;
      }
      for (const item of items) {
        if (item.kind !== "file") continue;
        const result = await migrateToOpaqueName(item.id, urk);
        if (result.status === "failed") {
          toast.error(result.error ?? "Could not hide the name");
          continue;
        }
        if (result.status === "already_migrated") continue;
        // The name now lives only in the index.
        const entry = nameIndex.entries.get(item.id);
        if (entry !== undefined && result.name !== null) {
          nameIndex.upsert({ ...entry, name: result.name });
        }
        toast.success(`"${result.name ?? item.name}" now has a name only you can read`);
        if (result.error !== null) toast.error(result.error);
      }
      invalidateDriveQueries(queryClient);
    },
    [nameIndex, queryClient, toast],
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
          if (item.kind === "file") {
            void downloadFile(item.id, item.file).catch((error) =>
              toast.error(errorMessage(error, "Could not download the file")),
            );
          }
          return;
        case "preview":
          if (item.kind === "file") setPreviewing(item);
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
        case "migrate":
          migrateBatch([item]);
          return;
        case "hideName":
          void hideName([item]);
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
    [
      onOpenItem,
      onShowDetails,
      migrateBatch,
      hideName,
      openMove,
      openReplacePicker,
      requestDelete,
      runBatch,
      toast,
    ],
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

      {previewing !== null ? (
        <FilePreview item={previewing} onClose={() => setPreviewing(null)} />
      ) : null}

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

      {migrating !== null ? (
        <ConfirmDialog
          title={
            migrating.length === 1
              ? `Encrypt "${migrating[0]?.name ?? "file"}"?`
              : `Encrypt ${migrating.length} files?`
          }
          message={
            migrating.length === 1
              ? "The file is encrypted in your browser before upload. Its plaintext copy is deleted only after the encrypted copy verifies. Older versions, if any, remain as plaintext history."
              : "Each selected file is encrypted in your browser before upload. For every file, the plaintext copy is deleted only after its encrypted copy verifies; older versions remain as plaintext history."
          }
          confirmLabel="Encrypt"
          busy={migrateMutation.isPending}
          onConfirm={() => migrateMutation.mutate(migrating)}
          onClose={() => {
            if (!migrateMutation.isPending) setMigrating(null);
          }}
        />
      ) : null}
    </>
  );

  return {
    handleAction,
    openMove,
    requestDelete,
    runBatch,
    migrateBatch,
    pendingBatch: batchMutation.isPending,
    dialogs,
  };
}
