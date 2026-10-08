import { Check, Loader2, RotateCcw, Upload, X } from "lucide-react";
import { formatBytes } from "../lib/format";
import type { UploadItem } from "../hooks/useUploads";

interface UploadsPanelProps {
  uploads: UploadItem[];
  onCancel: (id: number) => void;
  onRetry: (id: number) => void;
  onDismiss: (id: number) => void;
  onClearFinished: () => void;
}

function statusIcon(status: UploadItem["status"]) {
  if (status === "uploading") {
    return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gold-text" aria-hidden="true" />;
  }
  if (status === "done") return <Check className="h-4 w-4 shrink-0 text-ok" aria-hidden="true" />;
  if (status === "cancelled") return <X className="h-4 w-4 shrink-0" aria-hidden="true" />;
  return <X className="h-4 w-4 shrink-0 text-bad" aria-hidden="true" />;
}

/** Fixed bottom-left glass panel showing active, finished and failed uploads. */
export function UploadsPanel({
  uploads,
  onCancel,
  onRetry,
  onDismiss,
  onClearFinished,
}: UploadsPanelProps) {
  if (uploads.length === 0) return null;
  const hasFinished = uploads.some((upload) => upload.status !== "uploading");

  return (
    <section
      aria-label="Upload progress"
      className="glass-strong fixed bottom-4 left-4 z-40 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-line"
    >
      <header className="flex items-center justify-between border-b border-line/70 px-4 py-3">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold">
          <Upload className="h-4 w-4 text-gold" aria-hidden="true" />
          Uploads
        </h2>
        {hasFinished ? (
          <button
            type="button"
            onClick={onClearFinished}
            className="muted rounded px-1.5 py-0.5 text-xs transition-colors hover:bg-bg-soft hover:text-gold-text"
          >
            Clear finished
          </button>
        ) : null}
      </header>
      <ul className="max-h-72 divide-y divide-line/70 overflow-y-auto p-1.5">
        {uploads.map((upload) => (
          <li key={upload.id} className="px-2.5 py-2.5">
            <div className="flex items-center gap-2">
              {statusIcon(upload.status)}
              <span className="min-w-0 flex-1 truncate text-[13px]" title={upload.name}>
                {upload.name}
              </span>
              {upload.status === "uploading" ? (
                <span className="muted shrink-0 text-[12px] tabular-nums">
                  {formatBytes(upload.loaded)} / {formatBytes(upload.size)}
                </span>
              ) : (
                <span className="muted shrink-0 text-[12px] tabular-nums">
                  {formatBytes(upload.size)}
                </span>
              )}
            </div>

            {upload.status === "uploading" ? (
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div className="progress-fill" style={{ width: `${upload.percent}%` }} />
                </div>
                <span className="muted w-9 shrink-0 text-right text-[11px] tabular-nums">
                  {upload.percent}%
                </span>
                <button
                  type="button"
                  aria-label={`Cancel upload of ${upload.name}`}
                  onClick={() => onCancel(upload.id)}
                  className="muted rounded p-0.5 transition-colors hover:bg-bg-soft hover:text-bad"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : upload.status === "error" || upload.status === "cancelled" ? (
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <p
                  className={`min-w-0 flex-1 text-xs ${upload.status === "error" ? "text-bad" : "muted"}`}
                >
                  {upload.message ?? "Cancelled"}
                </p>
                <button
                  type="button"
                  className="muted inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors hover:bg-bg-soft hover:text-gold-text"
                  onClick={() => onRetry(upload.id)}
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Retry
                </button>
                <button
                  type="button"
                  aria-label={`Dismiss upload of ${upload.name}`}
                  onClick={() => onDismiss(upload.id)}
                  className="muted shrink-0 rounded p-0.5 transition-colors hover:bg-bg-soft hover:text-gold-text"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <div className="mt-1.5 flex justify-end">
                <button
                  type="button"
                  aria-label={`Dismiss upload of ${upload.name}`}
                  onClick={() => onDismiss(upload.id)}
                  className="muted rounded p-0.5 transition-colors hover:bg-bg-soft hover:text-gold-text"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
