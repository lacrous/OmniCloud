import type { QueryClient } from "@tanstack/react-query";
import type { SessionInfo } from "@omnicloud/shared";

export const ME_QUERY_KEY = ["me"] as const;
export const TREE_QUERY_KEY = ["tree"] as const;

/** Session snapshot used to force the signed-out state after logout or a 401. */
export const SIGNED_OUT_SESSION: SessionInfo = { user: null, storage: null };

/** Invalidates every drive-related query after a successful mutation. */
export function invalidateDriveQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["files"] });
  void queryClient.invalidateQueries({ queryKey: ["folders"] });
  void queryClient.invalidateQueries({ queryKey: TREE_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: ["search"] });
  void queryClient.invalidateQueries({ queryKey: ["subtree-files"] });
}
