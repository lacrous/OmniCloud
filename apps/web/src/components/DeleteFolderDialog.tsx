import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FolderDTO } from "@omnicloud/shared";
import { api, errorMessage } from "../api/client";
import { plural } from "../lib/format";
import { invalidateDriveQueries } from "../lib/queries";
import { subtreeFolderIds } from "../lib/tree";
import type { FolderNode } from "../lib/tree";
import { ConfirmDialog } from "./ConfirmDialog";
import { useToast } from "./Toasts";

interface DeleteFolderDialogProps {
  folder: FolderDTO;
  tree: FolderNode[];
  onClose: () => void;
}

/**
 * Destructive confirmation for recursive folder deletion. The file count is
 * computed by listing the files of every folder in the subtree.
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
    <ConfirmDialog
      title={`Delete "${folder.name}"?`}
      message={`This will permanently delete ${scope}. This action cannot be undone.`}
      confirmLabel="Delete"
      destructive
      busy={deleteMutation.isPending}
      onConfirm={() => deleteMutation.mutate()}
      onClose={onClose}
    />
  );
}
