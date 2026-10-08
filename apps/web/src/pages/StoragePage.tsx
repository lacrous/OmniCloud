import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  FileStack,
  HardDrive,
  Loader2,
  ShieldCheck,
  Star,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { IntegrityReportDTO } from "@omnicloud/shared";
import { api, errorMessage } from "../api/client";
import { formatBytes, formatDateTime, formatRelative, plural } from "../lib/format";
import { fileVisual } from "../lib/fileIcons";
import { fileToItem } from "../lib/drive";
import type { DriveItem } from "../lib/drive";
import { STORAGE_STATS_QUERY_KEY } from "../lib/queries";
import { DetailsPanel } from "../components/DetailsPanel";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { PageHeader, PageTitle } from "../components/PageHeader";
import { useToast } from "../components/Toasts";

function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-gold/40 bg-gold-soft text-gold-text">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="muted block text-[12px]">{label}</span>
        <span className="block truncate text-[15px] font-semibold tabular-nums">{value}</span>
      </span>
    </div>
  );
}

export default function StoragePage() {
  const toast = useToast();
  const [detailsItem, setDetailsItem] = useState<DriveItem | null>(null);
  const [deep, setDeep] = useState(false);

  const stats = useQuery({
    queryKey: STORAGE_STATS_QUERY_KEY,
    queryFn: api.storage.stats,
  });

  const integrity = useMutation({
    mutationFn: () => api.storage.integrityCheck(deep),
    onError: (error) => toast.error(errorMessage(error, "The integrity check failed")),
  });

  const data = stats.data?.stats;

  const typeRows = useMemo(() => {
    if (data === undefined) return [];
    const maxBytes = Math.max(1, ...data.byType.map((row) => row.bytes));
    return [...data.byType]
      .sort((a, b) => b.bytes - a.bytes)
      .map((row) => ({ ...row, percent: Math.round((row.bytes / maxBytes) * 100) }));
  }, [data]);

  if (stats.isPending) return <LoadingSpinner label="Loading storage statistics" />;

  if (stats.isError || data === undefined) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6 md:px-8">
        <PageHeader title={<PageTitle>Storage</PageTitle>} />
        <div className="card mt-6 p-6 text-center">
          <p className="text-sm font-medium">Could not load storage statistics.</p>
          <p className="muted mt-1 text-sm">
            {errorMessage(stats.error, "The storage backend may be unavailable.")}
          </p>
          <button type="button" className="btn-secondary mt-4" onClick={() => void stats.refetch()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  const quota = data.quotaBytes;
  const usedPercent =
    quota !== null && quota > 0 ? Math.min(100, (data.totalBytes / quota) * 100) : null;
  const report = integrity.data?.report;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-8">
      <PageHeader
        title={
          <div>
            <PageTitle>Storage</PageTitle>
            <p className="muted mt-1 text-[13px]">
              Keep an eye on usage, file types and storage health.
            </p>
          </div>
        }
      />

      <section className="card mt-5 p-5" aria-label="Usage">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <HardDrive className="h-4 w-4 text-gold" aria-hidden="true" />
            Usage
          </h2>
          <p className="muted text-[13px] tabular-nums">
            {formatBytes(data.totalBytes)}
            {quota !== null ? ` of ${formatBytes(quota)}` : " used"}
          </p>
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className="progress-fill"
            style={{
              width:
                usedPercent === null ? (data.totalBytes > 0 ? "100%" : "0%") : `${usedPercent}%`,
            }}
          />
        </div>
        {usedPercent !== null ? (
          <p className="muted mt-2 text-[12px] tabular-nums">
            {Math.round(usedPercent)}% of quota used
          </p>
        ) : (
          <p className="muted mt-2 text-[12px]">No quota set on this account.</p>
        )}
      </section>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard
          icon={<FileStack className="h-5 w-5" aria-hidden="true" />}
          label="Files"
          value={data.fileCount.toLocaleString()}
        />
        <StatCard
          icon={<HardDrive className="h-5 w-5" aria-hidden="true" />}
          label="Folders"
          value={data.folderCount.toLocaleString()}
        />
        <StatCard
          icon={<Star className="h-5 w-5" aria-hidden="true" />}
          label="Starred"
          value={data.starredCount.toLocaleString()}
        />
        <StatCard
          icon={<Trash2 className="h-5 w-5" aria-hidden="true" />}
          label="In trash"
          value={`${formatBytes(data.trashBytes)} · ${data.trashFileCount}`}
        />
      </div>

      <section className="card mt-6 p-5" aria-label="Breakdown by type">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Activity className="h-4 w-4 text-gold" aria-hidden="true" />
          By file type
        </h2>
        {typeRows.length === 0 ? (
          <p className="muted mt-3 text-[13px]">No files yet.</p>
        ) : (
          <ul className="mt-4 grid gap-3">
            {typeRows.map((row) => (
              <li key={row.category}>
                <div className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="font-medium capitalize">{row.category}</span>
                  <span className="muted tabular-nums">
                    {formatBytes(row.bytes)} · {plural(row.count, "file")}
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
                  <div className="progress-fill" style={{ width: `${row.percent}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card mt-6 p-5" aria-label="Largest files">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <FileStack className="h-4 w-4 text-gold" aria-hidden="true" />
          Largest files
        </h2>
        {data.largestFiles.length === 0 ? (
          <p className="muted mt-3 text-[13px]">No files yet.</p>
        ) : (
          <ul className="mt-3 grid gap-1.5">
            {data.largestFiles.map((file) => {
              const { Icon, color } = fileVisual(file.mimeType);
              return (
                <li key={file.id}>
                  <button
                    type="button"
                    onClick={() => setDetailsItem(fileToItem(file))}
                    className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-gold/40 hover:bg-bg-soft"
                  >
                    <Icon className={`h-5 w-5 shrink-0 ${color}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium" title={file.name}>
                      {file.name}
                    </span>
                    <span className="muted shrink-0 text-[12.5px] tabular-nums">
                      {formatBytes(file.size)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card mt-6 p-5" aria-label="Integrity check">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-gold" aria-hidden="true" />
            Integrity check
          </h2>
          <div className="flex items-center gap-3">
            <label className="muted flex items-center gap-2 text-[12.5px]">
              <input
                type="checkbox"
                checked={deep}
                onChange={(event) => setDeep(event.target.checked)}
                className="h-3.5 w-3.5"
                style={{ accentColor: "var(--gold)" }}
              />
              Deep scan
            </label>
            <button
              type="button"
              className="btn-gold px-3.5 py-2 text-[13px]"
              onClick={() => integrity.mutate()}
              disabled={integrity.isPending}
            >
              {integrity.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {integrity.isPending ? "Checking..." : "Run check"}
            </button>
          </div>
        </div>

        <p className="muted mt-2 text-[12.5px]">
          A deep scan re-downloads and hashes every file — slower, but catches silent corruption.
        </p>

        {integrity.isPending ? (
          <p className="muted mt-4 flex items-center gap-2 text-[13px]">
            <Loader2 className="h-4 w-4 animate-spin text-gold-text" aria-hidden="true" />
            Scanning your storage...
          </p>
        ) : report !== undefined ? (
          <IntegrityReportView report={report} />
        ) : null}
      </section>

      <DetailsPanel
        item={detailsItem}
        onClose={() => setDetailsItem(null)}
        onAction={() => undefined}
      />
    </div>
  );
}

function IntegrityReportView({ report }: { report: IntegrityReportDTO }) {
  const healthy = report.issues.length === 0;
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px]">
        <span className="flex items-center gap-1.5 font-medium">
          {healthy ? (
            <CheckCircle2 className="h-4 w-4 text-ok" aria-hidden="true" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-bad" aria-hidden="true" />
          )}
          {healthy ? "All files healthy" : `${plural(report.issues.length, "issue")} found`}
        </span>
        <span className="muted tabular-nums">{plural(report.filesChecked, "file")} checked</span>
        <span className="muted tabular-nums">{report.healthy} healthy</span>
        <span className="muted tabular-nums">{report.missing} missing</span>
        <span className="muted tabular-nums">{report.inconsistent} inconsistent</span>
        <span className="muted tabular-nums">{report.unreadable} unreadable</span>
        <span className="muted">checked {formatRelative(report.checkedAt)}</span>
      </div>

      {report.issues.length > 0 ? (
        <ul className="mt-3 grid gap-1.5">
          {report.issues.map((issue) => (
            <li
              key={`${issue.fileId}:${issue.kind}`}
              className="flex items-start gap-3 rounded-xl border border-line bg-bg-soft px-3 py-2.5"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-bad" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium" title={issue.name}>
                  {issue.name}
                </span>
                <span className="muted block text-[12px]">
                  {issue.kind.replace(/_/g, " ")}
                  {issue.detail !== null ? ` · ${issue.detail}` : ""}
                </span>
              </span>
              <span className="muted shrink-0 text-[11px]">{formatDateTime(report.checkedAt)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
