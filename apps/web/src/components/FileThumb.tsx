import { useEffect, useRef, useState } from "react";
import { fetchThumbnailBlob } from "../api/download";
import {
  beginThumbnail,
  failThumbnail,
  getThumbnail,
  isThumbnailable,
  setThumbnail,
} from "../lib/thumbnails";
import type { DriveItem } from "../lib/drive";

interface FileThumbProps {
  item: DriveItem;
  /** Rendered until the thumbnail is ready, or when there is none to show. */
  children: React.ReactNode;
}

/**
 * A drive card's media area.
 *
 * The thumbnail is fetched only once the card scrolls into view, so opening a
 * large drive does not download every image in it. Encrypted files are
 * decrypted in the tab exactly as the preview does; the bytes are exposed only
 * as an object URL held in a bounded cache, and are never written to disk.
 */
export function FileThumb({ item, children }: FileThumbProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const file = item.file;
  const thumbnailable = isThumbnailable(file);

  // Load when the card first becomes visible.
  useEffect(() => {
    if (!thumbnailable) return;
    const node = containerRef.current;
    if (node === null) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
          }
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [thumbnailable]);

  // Fetch once visible.
  useEffect(() => {
    if (!visible || !thumbnailable || file === null) return;
    const cached = getThumbnail(file.id);
    if (cached !== null) {
      setUrl(cached);
      return;
    }
    let cancelled = false;
    let settled = false;
    beginThumbnail(file.id);
    fetchThumbnailBlob(file.id, file)
      .then((blob) => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        settled = true;
        setThumbnail(file.id, objectUrl);
        setUrl(objectUrl);
      })
      .catch(() => {
        // A thumbnail is a nicety: on failure the card keeps its icon.
        settled = true;
        failThumbnail(file.id);
      });
    return () => {
      cancelled = true;
      // Drop the pending marker so a later mount can retry cleanly.
      if (!settled) failThumbnail(file.id);
    };
  }, [visible, thumbnailable, file]);

  return (
    <div ref={containerRef} className="relative flex h-full w-full items-center justify-center">
      {url !== null ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        children
      )}
    </div>
  );
}
