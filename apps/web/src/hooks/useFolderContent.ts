import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

/**
 * Loads the folders and files contained in `folderId` (null = root).
 * Both queries are disabled until the user's storage is initialized.
 */
export function useFolderContent(folderId: string | null, enabled: boolean) {
  const folders = useQuery({
    queryKey: ["folders", folderId],
    queryFn: () => api.folders.list(folderId),
    enabled,
    placeholderData: keepPreviousData,
  });

  const files = useQuery({
    queryKey: ["files", folderId],
    queryFn: () => api.files.list(folderId),
    enabled,
    placeholderData: keepPreviousData,
  });

  return { folders, files };
}
