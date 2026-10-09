import { ValidationError, type VersionRetentionPolicy } from "@omnicloud/core";
import {
  ITEM_STATUSES,
  normalizeLimit,
  normalizeOrder,
  normalizePage,
  normalizeSort,
} from "@omnicloud/shared";
import type { ItemStatus, ListQuery, SortField, SortOrder } from "@omnicloud/shared";

/** Reads a required string property from a parsed JSON body. */
export function requireString(body: unknown, field: string): string {
  const value = optionalString(body, field);
  if (value === undefined) {
    throw new ValidationError(`Field "${field}" is required`);
  }
  return value;
}

export function optionalString(body: unknown, field: string): string | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const value = (body as Record<string, unknown>)[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new ValidationError(`Field "${field}" must be a string`);
  }
  return value;
}

/** Reads a string-or-null property (used for parent/folder ids). */
export function stringOrNull(body: unknown, field: string): string | null {
  if (body === null || typeof body !== "object") {
    throw new ValidationError("A JSON object body is required");
  }
  const value = (body as Record<string, unknown>)[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value === "") return null;
  return value;
}

export function requireBody(request: { body?: unknown }): unknown {
  if (request.body === undefined || request.body === null) {
    throw new ValidationError("A JSON object body is required");
  }
  if (typeof request.body !== "object" || Array.isArray(request.body)) {
    throw new ValidationError("Request body must be a JSON object");
  }
  return request.body;
}

export function optionalBoolean(body: unknown, field: string): boolean | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const value = (body as Record<string, unknown>)[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ValidationError(`Field "${field}" must be a boolean`);
}

/** Reads a required array of non-empty strings, de-duplicated. */
export function requireStringArray(body: unknown, field: string, max = 500): string[] {
  if (body === null || typeof body !== "object") {
    throw new ValidationError("A JSON object body is required");
  }
  const value = (body as Record<string, unknown>)[field];
  if (!Array.isArray(value)) {
    throw new ValidationError(`Field "${field}" must be an array of ids`);
  }
  if (value.length === 0) throw new ValidationError(`Field "${field}" must not be empty`);
  if (value.length > max) {
    throw new ValidationError(`Field "${field}" accepts at most ${max} ids`);
  }
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      throw new ValidationError(`Field "${field}" must contain non-empty string ids`);
    }
    ids.push(item);
  }
  return [...new Set(ids)];
}

export function requireEnum<T extends string>(
  body: unknown,
  field: string,
  allowed: readonly T[],
): T {
  const value = requireString(body, field);
  if (!(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(`Field "${field}" must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// Query-string parsing
// ─────────────────────────────────────────────────────────────────────────────

function optionalQueryInt(value: unknown): number | undefined {
  if (value === undefined || value === "" || value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

function optionalQueryBool(value: unknown): boolean | undefined {
  if (value === undefined || value === "" || value === null) return undefined;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
}

function optionalQueryString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return value.trim();
}

export interface ParsedListQuery {
  query: ListQuery;
  page: number;
  limit: number;
}

/**
 * Parses the shared listing query string into a validated ListQuery plus
 * pagination, ignoring unknown/blank values rather than failing the request.
 */
export function parseListQuery(raw: Record<string, unknown>): ParsedListQuery {
  const status = optionalQueryString(raw.status);
  const query: ListQuery = {
    page: normalizePage(raw.page),
    limit: normalizeLimit(raw.limit),
    sort: normalizeSort(raw.sort) as SortField | undefined,
    order: normalizeOrder(raw.order) as SortOrder | undefined,
    q: optionalQueryString(raw.q),
    type: optionalQueryString(raw.type),
    ext: optionalQueryString(raw.ext),
    starred: optionalQueryBool(raw.starred),
    // Default to active items: normal views must never surface trashed
    // content. Trash/starred/search endpoints opt into their own scope.
    status:
      status && (ITEM_STATUSES as readonly string[]).includes(status)
        ? (status as ItemStatus)
        : "active",
    minSize: optionalQueryInt(raw.minSize),
    maxSize: optionalQueryInt(raw.maxSize),
    from: optionalQueryString(raw.from),
    to: optionalQueryString(raw.to),
  };

  // `folderId` presence is meaningful: absent = any folder, null = root.
  if ("folderId" in raw) {
    const folderId = raw.folderId;
    query.folderId = typeof folderId === "string" && folderId !== "" ? folderId : null;
  }

  return { query, page: query.page!, limit: query.limit! };
}

/**
 * Parses an explicit version-retention policy from a request body. Anything other
 * than a known kind with a whole, non-negative number is rejected, so a typo
 * cannot widen a prune.
 */
export function parseRetentionPolicy(body: unknown): VersionRetentionPolicy {
  const kind = requireString(body, "policy");
  if (kind === "KEEP_ALL") return { kind: "KEEP_ALL" };
  if (kind === "KEEP_LATEST_N") {
    const count = requireWholeNumber(body, "count");
    return { kind: "KEEP_LATEST_N", count };
  }
  if (kind === "KEEP_FOR_DAYS") {
    const days = requireWholeNumber(body, "days");
    if (days < 1) throw new ValidationError("days must be at least 1");
    return { kind: "KEEP_FOR_DAYS", days };
  }
  throw new ValidationError("policy must be KEEP_ALL, KEEP_LATEST_N or KEEP_FOR_DAYS");
}

function requireWholeNumber(body: unknown, field: string): number {
  const value = (body as Record<string, unknown> | null)?.[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ValidationError(`${field} must be a whole number of zero or more`);
  }
  return value;
}
