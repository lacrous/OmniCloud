/**
 * Filename-extension based MIME type detection.
 *
 * MIME types supplied by clients are never trusted: the API derives the MIME
 * type from the filename extension server-side. Shared so the web UI can use
 * the same logic for icons.
 */

const MIME_BY_EXTENSION: Record<string, string> = {
  // Documents
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  rtf: "application/rtf",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
  json: "application/json",
  epub: "application/epub+zip",

  // Images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  tiff: "image/tiff",
  tif: "image/tiff",
  avif: "image/avif",
  heic: "image/heic",

  // Audio
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  aac: "audio/aac",
  opus: "audio/opus",

  // Video
  mp4: "video/mp4",
  mkv: "video/x-matroska",
  webm: "video/webm",
  avi: "video/x-msvideo",
  mov: "video/quicktime",
  wmv: "video/x-ms-wmv",
  flv: "video/x-flv",

  // Archives
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  tar: "application/x-tar",
  gz: "application/gzip",
  bz2: "application/x-bzip2",
  xz: "application/x-xz",

  // Other
  apk: "application/vnd.android.package-archive",
  exe: "application/x-msdownload",
  dmg: "application/x-apple-diskimage",
  iso: "application/x-iso9660-image",
  bin: "application/octet-stream",
};

export const DEFAULT_MIME_TYPE = "application/octet-stream";

/** Returns the file extension without the leading dot, lowercased. */
export function fileExtension(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/** Derives a MIME type from the filename extension. Never trusts client input. */
export function mimeFromFilename(filename: string): string {
  return MIME_BY_EXTENSION[fileExtension(filename)] ?? DEFAULT_MIME_TYPE;
}

export type FileCategory =
  "image" | "video" | "audio" | "pdf" | "archive" | "document" | "text" | "other";

const PREFIXED_CATEGORIES: Array<[string, FileCategory]> = [
  ["image/", "image"],
  ["video/", "video"],
  ["audio/", "audio"],
  ["application/pdf", "pdf"],
  ["application/zip", "archive"],
  ["application/x-tar", "archive"],
  ["application/gzip", "archive"],
  ["application/x-7z-compressed", "archive"],
  ["application/vnd.rar", "archive"],
  ["application/x-bzip2", "archive"],
  ["application/x-xz", "archive"],
  ["text/", "text"],
  ["application/json", "text"],
  ["application/xml", "text"],
  ["application/yaml", "text"],
  ["application/javascript", "text"],
  ["text/markdown", "text"],
];

const OFFICE_MIMES = new Set([
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/rtf",
  "application/epub+zip",
]);

/** Coarse category used for icon selection in the UI. */
export function fileCategory(mimeType: string): FileCategory {
  for (const [prefix, category] of PREFIXED_CATEGORIES) {
    if (mimeType.startsWith(prefix)) return category;
  }
  if (OFFICE_MIMES.has(mimeType)) return "document";
  return "other";
}
