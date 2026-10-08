import { useMemo, useState } from "react";
import { Clock, Download } from "lucide-react";
import type { ActivityAction } from "@omnicloud/shared";
import { api, errorMessage } from "../api/client";
import { dayLabel, formatBytes, formatDateTime } from "../lib/format";
import { fileVisual } from "../lib/fileIcons";
import { fileToItem } from "../lib/drive";
import type { DriveItem } from "../lib/drive";
import { useInfiniteList } from "../hooks/useInfiniteList";
import { DetailsPanel } from "../components/DetailsPanel";
import { EmptyState } from "../components/EmptyState";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { PageHeader, PageTitle } from "../components/PageHeader";

const PAGE_LIMIT = 100;

const ACTION_LABELS: Record<ActivityAction, string> = {
  upload: "Uploaded",
  download: "Downloaded",
  open: "Opened",
  rename: "Renamed",
  move: "Moved",
  star: "Starred",
  unstar: "Unstarred",
  trash: "Trashed",
  restore: "Restored",
  delete: "Deleted",
  create_folder: "Created folder",
  replace: "New version",
};

interface RecentRow {
  key: string;
  item: DriveItem;
  action: ActivityAction;
  at: string;
  label: string;
}

export default function RecentPage() {
  const [detailsItem, setDetailsItem] = useState<DriveItem | null>(null);

  const recent = useInfiniteList({
    queryKey: ["recent"],
    queryFn: (page) =>
      api.recent.list({ page, limit: PAGE_LIMIT }).then((result) => ({
        items: result.items.map((entry) => ({
          key: `${entry.file.id}:${entry.lastActionAt}`,
          item: fileToItem(entry.file),
          action: entry.lastAction,
          at: entry.lastActionAt,
          label: dayLabel(entry.lastActionAt),
        })),
        pagination: result.pagination,
      })),
  });

  const groups = useMemo(() => {
    const map = new Map<string, RecentRow[]>();
    for (const row of recent.items) {
      const bucket = map.get(row.label);
      if (bucket === undefined) map.set(row.label, [row]);
      else bucket.push(row);
    }
    return Array.from(map.entries());
  }, [recent.items]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-8">
      <PageHeader
        title={
          <div>
            <PageTitle>Recent</PageTitle>
            <p className="muted mt-1 text-[13px]">What you have touched lately, newest first.</p>
          </div>
        }
      />

      {recent.isLoading ? (
        <LoadingSpinner label="Loading recent activity" />
      ) : recent.isError ? (
        <div className="card mt-6 p-6 text-center">
          <p className="text-sm font-medium">Something went wrong.</p>
          <p className="muted mt-1 text-sm">
            {errorMessage(recent.error, "Could not load recent activity.")}
          </p>
          <button type="button" className="btn-secondary mt-4" onClick={recent.refetch}>
            Try again
          </button>
        </div>
      ) : recent.items.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="Nothing recent"
          description="Uploads, downloads and edits will appear here."
        />
      ) : (
        <div className="mt-5 grid gap-6">
          {groups.map(([label, rows]) => (
            <section key={label}>
              <h2 className="eyebrow">{label}</h2>
              <ul className="mt-3 grid gap-1.5">
                {rows.map((row) => {
                  const { Icon, color } = fileVisual(row.item.mimeType);
                  return (
                    <li
                      key={row.key}
                      className="group flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 transition-colors hover:border-gold/40 hover:bg-bg-soft"
                    >
                      <button
                        type="button"
                        onClick={() => setDetailsItem(row.item)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <Icon className={`h-5 w-5 shrink-0 ${color}`} aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span
                            className="block truncate text-sm font-medium"
                            title={row.item.name}
                          >
                            {row.item.name}
                          </span>
                          <span className="muted block text-[12px]">
                            {ACTION_LABELS[row.action]}
                            <span className="mx-1.5" aria-hidden="true">
                              ·
                            </span>
                            {formatDateTime(row.at)}
                          </span>
                        </span>
                        <span className="muted hidden shrink-0 text-[12.5px] tabular-nums sm:block">
                          {formatBytes(row.item.size)}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Download ${row.item.name}`}
                        onClick={() => api.files.download(row.item.id)}
                        className="muted grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors hover:bg-bg-soft hover:text-gold-text"
                      >
                        <Download className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {recent.hasMore ? (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            className="btn-secondary"
            onClick={recent.loadMore}
            disabled={recent.isLoadingMore}
          >
            {recent.isLoadingMore ? "Loading..." : "Load more"}
          </button>
        </div>
      ) : null}

      <DetailsPanel
        item={detailsItem}
        onClose={() => setDetailsItem(null)}
        onAction={(action, item) => {
          if (action === "download") api.files.download(item.id);
        }}
      />
    </div>
  );
}
