import { Check, Loader2, Upload, X } from "lucide-react";
import { formatBytes } from "../lib/format";

export type UploadStatus = "uploading" | "done" | "error";

export interface UploadItem {
  id: number;
  name: string;
  size: number;
  percent: number;
  status: UploadStatus;
  message?: string;
}

interface UploadsPanelProps {
  uploads: UploadItem[];
  onDismiss: (id: number) => void;
  onClearFinished: () => void;
}

/** Fixed bottom-right glass panel showing the active and finished uploads. */
export function UploadsPanel({ uploads, onDismiss, onClearFinished }: UploadsPanelProps) {
  if (uploads.length === 0) return null;
  const hasFinished = uploads.some((upload) => upload.status !== "uploading");

  return (
    <section
      aria-label="Upload progress"
      className="glass-strong fixed right-4 bottom-4 z-40 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-line"
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
      <ul className="max-h-64 divide-y divide-line/70 overflow-y-auto p-1.5">
        {uploads.map((upload) => (
          <li key={upload.id} className="px-2.5 py-2.5">
            <div className="flex items-center gap-2">
              {upload.status === "uploading" ? (
                <Loader2
                  className="h-4 w-4 shrink-0 animate-spin text-gold-text"
                  aria-hidden="true"
                />
              ) : upload.status === "done" ? (
                <Check className="h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
              ) : (
                <X className="h-4 w-4 shrink-0 text-bad" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1 truncate text-[13px]" title={upload.name}>
                {upload.name}
              </span>
              <span className="muted shrink-0 text-[12px] tabular-nums">
                {formatBytes(upload.size)}
              </span>
              <button
                type="button"
                aria-label={`Dismiss upload of ${upload.name}`}
                onClick={() => onDismiss(upload.id)}
                className="muted rounded p-0.5 transition-colors hover:bg-bg-soft hover:text-gold-text"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            {upload.status === "uploading" ? (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="progress-fill" style={{ width: `${upload.percent}%` }} />
              </div>
            ) : null}
            {upload.status === "error" && upload.message !== undefined ? (
              <p className="mt-1.5 text-xs text-bad">{upload.message}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
