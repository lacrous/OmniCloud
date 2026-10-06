import { formatBytes } from "../lib/format";
import { CheckIcon, Spinner, XIcon } from "./icons";

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

/** Fixed bottom-right panel showing the active and finished uploads. */
export function UploadsPanel({ uploads, onDismiss, onClearFinished }: UploadsPanelProps) {
  if (uploads.length === 0) return null;
  const hasFinished = uploads.some((upload) => upload.status !== "uploading");

  return (
    <section
      aria-label="Upload progress"
      className="fixed bottom-4 right-4 z-40 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
    >
      <header className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <h2 className="text-sm font-medium text-gray-900">Uploads</h2>
        {hasFinished && (
          <button
            type="button"
            onClick={onClearFinished}
            className="rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none"
          >
            Clear finished
          </button>
        )}
      </header>
      <ul className="max-h-64 divide-y divide-gray-100 overflow-y-auto p-1">
        {uploads.map((upload) => (
          <li key={upload.id} className="px-2 py-2">
            <div className="flex items-center gap-2">
              {upload.status === "uploading" ? (
                <Spinner className="h-4 w-4 shrink-0 text-indigo-600" />
              ) : upload.status === "done" ? (
                <CheckIcon className="h-4 w-4 shrink-0 text-emerald-600" />
              ) : (
                <XIcon className="h-4 w-4 shrink-0 text-red-600" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm text-gray-900" title={upload.name}>
                {upload.name}
              </span>
              <span className="shrink-0 text-xs text-gray-400 tabular-nums">
                {formatBytes(upload.size)}
              </span>
              <button
                type="button"
                aria-label={`Dismiss upload of ${upload.name}`}
                onClick={() => onDismiss(upload.id)}
                className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            {upload.status === "uploading" ? (
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-indigo-600 transition-[width] duration-200"
                  style={{ width: `${upload.percent}%` }}
                />
              </div>
            ) : null}
            {upload.status === "error" && upload.message !== undefined ? (
              <p className="mt-1.5 text-xs text-red-600">{upload.message}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
