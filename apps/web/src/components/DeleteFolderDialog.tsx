import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { FolderDTO } from "@omnicloud/shared";
import { api, errorMessage } from "../api/client";
import { plural } from "../lib/format";
import { invalidateDriveQueries } from "../lib/queries";
import { subtreeFolderIds } from "../lib/tree";
import type { FolderNode } from "../lib/tree";
import { Modal } from "./Modal";
import { useToast } from "./Toasts";

interface DeleteFolderDialogProps {
  folder: FolderDTO;
  tree: FolderNode[];
  onClose: () => void;
}

/**
 * Destructive confirmation for recursive folder deletion. The file count is
 * computed by listing the files of every folder in the subtree. Presented as
 * the house danger-zone treatment inside the standard dialog.
 */
export function DeleteFolderDialog({ folder, tree, onClose }: DeleteFolderDialogProps) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const fileCountQuery = useQuery({
    queryKey: ["subtree-files", folder.id],
    queryFn: async () => {
      const ids = subtreeFolderIds(tree, folder.id);
      const responses = await Promise.all(ids.map((id) => api.files.list(id)));
      return responses.reduce((total, response) => total + response.files.length, 0);
    },
    staleTime: 0,
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.folders.delete(folder.id),
    onSuccess: (result) => {
      invalidateDriveQueries(queryClient);
      toast.success(
        `Deleted ${plural(result.deletedFolders, "folder")} and ${plural(result.deletedFiles, "file")}`,
      );
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error, "Could not delete folder")),
  });

  const subfolderCount = subtreeFolderIds(tree, folder.id).length - 1;
  const fileCount = fileCountQuery.data;

  let scope = `the folder "${folder.name}"`;
  if (subfolderCount > 0) scope += ` and its ${plural(subfolderCount, "subfolder")}`;
  if (fileCount !== undefined) {
    scope += ` and ${plural(fileCount, "file")}`;
  } else {
    scope += " and all files inside it";
  }

  return (
    <Modal title={`Delete "${folder.name}"?`} onClose={onClose}>
      <section className="rounded-2xl border border-bad/40 p-5">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-bad" aria-hidden="true" />
          <h3 className="text-[15px] font-semibold">Danger zone</h3>
        </div>
        <p className="muted mt-1.5 text-[13px] leading-relaxed">
          This will permanently delete {scope}. This action cannot be undone.
        </p>
      </section>
      <div className="mt-5 flex justify-end gap-2.5">
        <button
          type="button"
          className="btn-ghost"
          onClick={onClose}
          disabled={deleteMutation.isPending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn-danger"
          onClick={() => deleteMutation.mutate()}
          disabled={deleteMutation.isPending}
        >
          {deleteMutation.isPending && (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          )}
          Delete
        </button>
      </div>
    </Modal>
  );
}
