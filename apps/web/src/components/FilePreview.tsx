import { Download, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { downloadFile, fetchDecryptedPreview } from "../api/download";
import { errorMessage } from "../api/client";
import type { DriveItem } from "../lib/drive";
import { LoadingSpinner } from "./LoadingSpinner";

interface FilePreviewProps {
  item: DriveItem;
  onClose: () => void;
}

/**
 * Previews an end-to-end encrypted file in the browser.
 *
 * The file is decrypted into a Blob in memory and shown through an object URL
 * that is revoked as soon as the dialog closes or the item changes. Nothing is
 * written to disk or to a cache, and legacy plaintext files are never routed
 * here — only files the user has already chosen to encrypt get this treatment.
 *
 * Files above the preview ceiling keep the normal streaming download, which
 * writes to disk instead of holding the file in a tab.
 */
export function FilePreview({ item, onClose }: FilePreviewProps) {
  // Only ever opened for a file item; narrow once so the effect body and the
  // render below can rely on it.
  const file = item.file;
  // Key the effect on the identity of the *file*, not on the DTO object: a
  // parent re-render that produces a new object with the same contents must
  // not re-download and re-decrypt the file.
  const fileId = file?.id ?? null;
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (file === null || fileId === null) return;
    let revoked: string | null = null;
    let cancelled = false;
    setUrl(null);
    setError(null);
    setLoading(true);

    fetchDecryptedPreview(fileId, file)
      .then((preview) => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(preview.blob);
        revoked = objectUrl;
        setUrl(objectUrl);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(errorMessage(cause, "Could not preview this file."));
        setLoading(false);
      });

    // Revoke on unmount or when the previewed item changes, so decrypted bytes
    // never outlive the view that produced them.
    return () => {
      cancelled = true;
      if (revoked !== null) URL.revokeObjectURL(revoked);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  return (
    <Modal title={item.name} onClose={onClose}>
      <div className="space-y-4">
        <p className="muted flex items-center gap-1.5 text-[12.5px]">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          End-to-end encrypted — decrypted in this tab and never cached.
        </p>

        {loading ? (
          <div className="flex min-h-[220px] items-center justify-center">
            <LoadingSpinner label="Decrypting preview…" />
          </div>
        ) : error !== null ? (
          // Covers every failure, including a file above the preview ceiling —
          // fetchDecryptedPreview rejects before downloading in that case, so an
          // oversized file never reaches the network.
          <div className="glass rounded-xl border border-line p-4 text-[13px]">
            <p className="text-[#d9534f] dark:text-[#e97066]">{error}</p>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => void downloadFile(item.id, file)}
                className="btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px]"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                Download instead
              </button>
            </div>
          </div>
        ) : url !== null ? (
          <PreviewBody url={url} name={item.name} />
        ) : null}
      </div>
    </Modal>
  );
}

function PreviewBody({ url, name }: { url: string; name: string }) {
  const lower = name.toLowerCase();
  const isVideo = /\.(mp4|webm|ogg|mov|m4v)$/.test(lower);

  if (isVideo) {
    return <video src={url} controls className="max-h-[60vh] w-full rounded-xl" />;
  }
  // Anything else that made it through is treated as an image; a wrong type
  // simply renders as a broken image rather than leaking anything.
  return <img src={url} alt={name} className="max-h-[60vh] w-full rounded-xl object-contain" />;
}
