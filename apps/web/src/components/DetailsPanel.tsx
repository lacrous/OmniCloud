import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { Download, Folder, RefreshCw, X } from "lucide-react";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { api, errorMessage } from "../api/client";
import { formatBytes, formatDateTime, plural } from "../lib/format";
import { fileVisual } from "../lib/fileIcons";
import type { DriveItem } from "../lib/drive";
import type { ItemAction } from "./itemActions";

interface DetailsPanelProps {
  item: DriveItem | null;
  onClose: () => void;
  onAction: (action: ItemAction, item: DriveItem) => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="muted text-[11px] font-semibold tracking-wide uppercase">{label}</dt>
      <dd className="mt-1 text-[13.5px] break-words">{children}</dd>
    </div>
  );
}

function ItemGlyph({ item }: { item: DriveItem }) {
  if (item.kind === "folder") {
    return <Folder className="h-6 w-6 shrink-0 text-gold" aria-hidden="true" />;
  }
  const { Icon, color } = fileVisual(item.mimeType);
  return <Icon className={`h-6 w-6 shrink-0 ${color}`} aria-hidden="true" />;
}

/**
 * Slide-over with file/folder metadata and version history. On desktop it slides
 * in from the right; on small screens it becomes a bottom sheet. Escape closes.
 */
export function DetailsPanel({ item, onClose, onAction }: DetailsPanelProps) {
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (item === null) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [item, onClose]);

  if (item === null) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-end sm:items-stretch">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-label={`Details for ${item.name}`}
        initial={reduceMotion ? { opacity: 0 } : { x: "100%" }}
        animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="glass-strong relative flex max-h-[85dvh] w-full flex-col rounded-t-2xl border border-line sm:h-full sm:max-h-none sm:w-96 sm:rounded-none sm:border-r-0"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line/70 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <ItemGlyph item={item} />
            <h2 className="min-w-0 text-[15px] font-semibold break-words">{item.name}</h2>
          </div>
          <button
            type="button"
            aria-label="Close details"
            onClick={onClose}
            className="muted grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors hover:bg-bg-soft hover:text-gold-text"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!item.trashed ? (
            <div className="flex flex-wrap gap-2">
              {item.kind === "file" ? (
                <>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => onAction("download", item)}
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Download
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => onAction("replace", item)}
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                    New version
                  </button>
                </>
              ) : null}
            </div>
          ) : null}

          <dl className="mt-5 grid gap-4">
            <Field label="Type">
              {item.kind === "folder" ? "Folder" : fileVisual(item.mimeType).label}
              {item.kind === "file" ? <span className="muted"> · {item.mimeType}</span> : null}
            </Field>
            {item.kind === "file" ? <Field label="Size">{formatBytes(item.size)}</Field> : null}
            {item.kind === "file" ? (
              <Field label="SHA-256">
                <code className="font-mono text-[12px] break-all select-all">
                  {item.file?.sha256 ?? ""}
                </code>
              </Field>
            ) : null}
            <Field label="Folder">
              {item.kind === "file"
                ? (item.file?.folderId ?? "My Drive")
                : (item.folder?.parentId ?? "My Drive")}
            </Field>
            <Field label="Created">{formatDateTime(item.createdAt)}</Field>
            <Field label="Modified">{formatDateTime(item.updatedAt)}</Field>
            {item.trashed && item.deletedAt !== null ? (
              <Field label="Deleted">{formatDateTime(item.deletedAt)}</Field>
            ) : null}
            {item.kind === "file" ? (
              <Field label="Versions">{plural(item.versionCount, "version")}</Field>
            ) : null}
          </dl>

          {item.kind === "file" ? (
            <VersionList fileId={item.id} versionCount={item.versionCount} />
          ) : null}
        </div>
      </motion.aside>
    </div>
  );
}

function VersionList({ fileId, versionCount }: { fileId: string; versionCount: number }) {
  const versions = useQuery({
    queryKey: ["versions", fileId],
    queryFn: () => api.files.versions(fileId),
  });

  return (
    <section className="mt-6">
      <h3 className="eyebrow">Version history</h3>
      {versions.isPending ? (
        <p className="muted mt-3 text-[13px]">Loading versions...</p>
      ) : versions.error !== null ? (
        <p className="mt-3 text-[13px] text-bad">
          {errorMessage(versions.error, "Could not load versions")}
        </p>
      ) : (versions.data?.versions.length ?? 0) === 0 ? (
        <p className="muted mt-3 text-[13px]">
          {versionCount > 1 ? "Version history is unavailable." : "No earlier versions."}
        </p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {(versions.data?.versions ?? []).map((version) => (
            <li
              key={version.id}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2"
            >
              <span className="muted w-9 shrink-0 font-mono text-[12px]">
                v{version.versionNumber}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px]">{formatBytes(version.size)}</span>
                <span className="muted block text-[11px]">{formatDateTime(version.createdAt)}</span>
              </span>
              {version.isCurrent ? (
                <span className="shrink-0 rounded-full border border-gold/50 bg-gold-soft px-2 py-0.5 text-[11px] font-medium text-gold-text">
                  Current
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
