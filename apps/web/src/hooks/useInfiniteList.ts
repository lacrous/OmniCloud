import { useInfiniteQuery } from "@tanstack/react-query";
import type { PaginationDTO } from "@omnicloud/shared";

/** A single page of list results, matching the API's pagination envelope. */
export interface ListPage<T> {
  items: T[];
  pagination: PaginationDTO;
}

export interface InfiniteListResult<T> {
  items: T[];
  pagination: PaginationDTO | null;
  /** First page is loading (no data yet). */
  isLoading: boolean;
  /** A subsequent page is loading. */
  isLoadingMore: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  hasMore: boolean;
  loadMore: () => void;
  refetch: () => void;
}

interface UseInfiniteListOptions<T> {
  queryKey: readonly unknown[];
  queryFn: (page: number) => Promise<ListPage<T>>;
  enabled?: boolean;
}

/**
 * Wraps TanStack's infinite query for the API's page envelope, flattening pages
 * into a single item array and exposing a `loadMore` bound to `hasMore`.
 */
export function useInfiniteList<T>({
  queryKey,
  queryFn,
  enabled = true,
}: UseInfiniteListOptions<T>): InfiniteListResult<T> {
  const query = useInfiniteQuery({
    queryKey,
    enabled,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => queryFn(pageParam),
    getNextPageParam: (lastPage: ListPage<T>) =>
      lastPage.pagination.hasMore ? lastPage.pagination.page + 1 : undefined,
  });

  const pages = query.data?.pages ?? [];
  const items = pages.flatMap((page) => page.items);
  const lastPage = pages[pages.length - 1];

  return {
    items,
    pagination: lastPage?.pagination ?? null,
    isLoading: query.isPending,
    isLoadingMore: query.isFetchingNextPage,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    hasMore: query.hasNextPage,
    loadMore: () => {
      void query.fetchNextPage();
    },
    refetch: () => {
      void query.refetch();
    },
  };
}
