/**
 * Sanitizes a client-supplied filename into a safe, single path component.
 * Returns an empty string when nothing usable remains.
 */
export function sanitizeFileName(name: string): string {
  // Drop any path components — prevents path traversal.
  const base = name.split(/[/\\]/).pop() ?? name;
  // Strip control characters and characters that are unsafe across filesystems.
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return "";
  return cleaned.slice(0, 255);
}
