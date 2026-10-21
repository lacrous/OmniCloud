import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { UPDATE_CHECK_QUERY_KEY } from "../lib/queries";

/**
 * Update availability, polled from the server's cached npm check.
 *
 * The server refreshes its result hourly, so the browser only needs to poll
 * often enough to notice a new release without generating noise: every ten
 * minutes is well inside the server's cadence and costs one tiny local
 * request.
 */
export function useUpdateCheck() {
  return useQuery({
    queryKey: UPDATE_CHECK_QUERY_KEY,
    queryFn: api.update.check,
    // The server is the source of truth for how often this actually changes.
    refetchInterval: 10 * 60 * 1000,
    // Refetch when the tab regains focus, so a user returning to an open tab
    // sees a release that appeared while they were away.
    refetchOnWindowFocus: true,
    // A failed check is not worth retrying aggressively; the server retries
    // on its own schedule.
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}
