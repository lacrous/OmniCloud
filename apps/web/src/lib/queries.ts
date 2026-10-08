import type { QueryClient } from "@tanstack/react-query";
import type { SessionInfo } from "@omnicloud/shared";

export const ME_QUERY_KEY = ["me"] as const;
export const TREE_QUERY_KEY = ["folders", "tree"] as const;
export const STORAGE_STATS_QUERY_KEY = ["storage", "stats"] as const;
export const STORAGE_HEALTH_QUERY_KEY = ["storage", "health"] as const;

/** Session snapshot used to force the signed-out state after logout or a 401. */
export const SIGNED_OUT_SESSION: SessionInfo = { user: null, storage: null, health: null };

/** Invalidates every drive-related query after a successful mutation. */
export function invalidateDriveQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["files"] });
  void queryClient.invalidateQueries({ queryKey: ["folders"] });
  void queryClient.invalidateQueries({ queryKey: ["trash"] });
  void queryClient.invalidateQueries({ queryKey: ["starred"] });
  void queryClient.invalidateQueries({ queryKey: ["recent"] });
  void queryClient.invalidateQueries({ queryKey: ["search"] });
  void queryClient.invalidateQueries({ queryKey: ["activity"] });
  void queryClient.invalidateQueries({ queryKey: ["subtree-files"] });
  void queryClient.invalidateQueries({ queryKey: ["storage"] });
}

/** Invalidates queries that depend on a file's version history. */
export function invalidateVersionQueries(queryClient: QueryClient, fileId: string): void {
  void queryClient.invalidateQueries({ queryKey: ["versions", fileId] });
}
