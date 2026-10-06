import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { ME_QUERY_KEY } from "../lib/queries";

/** Returns the current session (user + storage), cached under the shared "me" key. */
export function useMe() {
  return useQuery({ queryKey: ME_QUERY_KEY, queryFn: api.auth.me });
}
