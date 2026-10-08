/**
 * Search query parsing, pagination and sorting primitives.
 *
 * Self-contained (no runtime imports from the package root) so the API, web
 * app and SDK can all share one query language without import cycles.
 *
 * Query language (v0.2):
 *   report                                  → name contains "report"
 *   name:report                             → same, explicit
 *   type:pdf  type:image  type:application/zip
 *   ext:zip                                 → file extension (no dot)
 *   size:>100MB  size:<1KB  size:5mb
 *   folder:Projects                         → folder-name filter
 *   starred:true  trashed:true
 *   after:2026-01-01  before:2026-06-01
 */

export const SORT_FIELDS = ["name", "size", "createdAt", "updatedAt", "type"] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export const SORT_ORDERS = ["asc", "desc"] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export const ITEM_STATUSES = ["active", "trashed", "all"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/** Query parameters accepted by the file/folder listing endpoints. */
export interface ListQuery {
  folderId?: string | null;
  page?: number;
  limit?: number;
  sort?: SortField;
  order?: SortOrder;
  /** MIME type or coarse category (image, video, pdf, document, …). */
  type?: string;
  /** File extension without the dot. */
  ext?: string;
  starred?: boolean;
  status?: ItemStatus;
  /** Name substring filter. */
  q?: string;
  /** Folder-name filter (search parser); resolved to ids by the caller. */
  folderName?: string;
  minSize?: number;
  maxSize?: number;
  /** Inclusive date bounds (ISO strings). */
  from?: string;
  to?: string;
}

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
  tb: 1024 ** 4,
};

/** Parses "100MB", "1.5gb", "512" into bytes. Returns null when unparseable. */
export function parseSize(value: string): number | null {
  const match = /^\s*([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]*)\s*$/.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const unit = (match[2] ?? "").toLowerCase() || "b";
  const factor = SIZE_UNITS[unit];
  if (factor === undefined) return null;
  return Math.round(amount * factor);
}

/** Parses a size comparison such as ">100MB", "<=2gb", "5mb". */
export function parseSizeComparison(value: string): { min?: number; max?: number } | null {
  const match = /^\s*(>=|<=|>|<|=)?\s*(.+)$/.exec(value);
  if (!match) return null;
  const operator = match[1] ?? "=";
  const bytes = parseSize(match[2]!);
  if (bytes === null) return null;

  switch (operator) {
    case ">":
      return { min: bytes + 1 };
    case ">=":
      return { min: bytes };
    case "<":
      return { max: bytes - 1 };
    case "<=":
      return { max: bytes };
    default:
      return { min: bytes, max: bytes };
  }
}

function parseBoolean(value: string): boolean | null {
  const normalized = value.toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  return null;
}

function parseDate(value: string, endOfDay: boolean): Date | null {
  const trimmed = value.trim();
  // Plain dates are interpreted as the start (or end) of that UTC day so
  // `after:2026-01-01` and `before:2026-01-01` behave intuitively.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const date = new Date(`${trimmed}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Parses a raw user query string into structured filters. */
export function parseSearchQuery(
  input: string,
  base: ListQuery = {},
): { query: ListQuery; freeText: string } {
  const query: ListQuery = { ...base };
  const terms: string[] = [];

  for (const rawToken of input.trim().split(/\s+/)) {
    if (!rawToken) continue;

    const separator = rawToken.indexOf(":");
    if (separator <= 0) {
      terms.push(rawToken);
      continue;
    }

    const field = rawToken.slice(0, separator).toLowerCase();
    const value = rawToken.slice(separator + 1);
    if (!value) {
      terms.push(rawToken);
      continue;
    }

    switch (field) {
      case "name":
      case "filename":
        terms.push(value);
        break;
      case "type":
        // Accept either a MIME type ("application/pdf") or a coarse category.
        query.type = value.toLowerCase();
        break;
      case "ext":
      case "extension":
        query.ext = value.replace(/^\./, "").toLowerCase();
        break;
      case "size": {
        const comparison = parseSizeComparison(value);
        if (!comparison) {
          terms.push(rawToken);
          break;
        }
        if (comparison.min !== undefined) query.minSize = comparison.min;
        if (comparison.max !== undefined) query.maxSize = comparison.max;
        break;
      }
      case "folder":
        query.folderName = value;
        break;
      case "starred": {
        const parsed = parseBoolean(value);
        if (parsed === null) terms.push(rawToken);
        else query.starred = parsed;
        break;
      }
      case "trashed":
      case "deleted": {
        const parsed = parseBoolean(value);
        if (parsed === null) terms.push(rawToken);
        else query.status = parsed ? "trashed" : "active";
        break;
      }
      case "after":
      case "since": {
        const date = parseDate(value, false);
        if (!date) terms.push(rawToken);
        else query.from = date.toISOString();
        break;
      }
      case "before": {
        const date = parseDate(value, true);
        if (!date) terms.push(rawToken);
        else query.to = date.toISOString();
        break;
      }
      default:
        terms.push(rawToken);
        break;
    }
  }

  const freeText = terms.join(" ").trim();
  if (freeText) query.q = freeText;
  return { query, freeText };
}

export function normalizePage(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return parsed;
}

export function normalizeLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(parsed, MAX_PAGE_SIZE);
}

export function normalizeSort(value: unknown): SortField | undefined {
  if (typeof value !== "string") return undefined;
  return (SORT_FIELDS as readonly string[]).includes(value) ? (value as SortField) : undefined;
}

export function normalizeOrder(value: unknown): SortOrder | undefined {
  if (typeof value !== "string") return undefined;
  return (SORT_ORDERS as readonly string[]).includes(value) ? (value as SortOrder) : undefined;
}

/** Builds the pagination envelope for a result page. */
export function paginationMeta(page: number, limit: number, total: number) {
  return { page, limit, total, hasMore: page * limit < total };
}
