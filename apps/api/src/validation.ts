import { ValidationError, type VersionRetentionPolicy } from "@omnicloud/core";
import type { MultipartFields } from "@fastify/multipart";
import {
  ENCRYPTION_FORMATS,
  isEncryptionFormat,
  ITEM_STATUSES,
  normalizeLimit,
  normalizeOrder,
  normalizePage,
  normalizeSort,
} from "@omnicloud/shared";
import type {
  EncryptionFormat,
  ItemStatus,
  ListQuery,
  SortField,
  SortOrder,
} from "@omnicloud/shared";

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

// ─────────────────────────────────────────────────────────────────────────────
// OCE1 encryption metadata (multipart text fields)
// ─────────────────────────────────────────────────────────────────────────────

/** Reads one multipart text field; empty values count as absent. */
function multipartTextField(fields: MultipartFields, name: string): string | undefined {
  const field = fields[name];
  if (!field || Array.isArray(field) || field.type !== "field") return undefined;
  return typeof field.value === "string" && field.value !== "" ? field.value : undefined;
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const KEY_EPOCH_PATTERN = /^\d+$/;
const MAX_UINT32 = 4294967295;
/** OCE1 recovery blob: 24-byte nonce + 32-byte sealed URK + 16-byte tag. */
const RECOVERY_BLOB_BYTES = 72;

/**
 * Validates an opaque OCE1 recovery blob from a JSON body. The server checks
 * only the base64 alphabet and exact decoded length; it cannot open the blob.
 */
export function parseRecoveryBlob(request: { body?: unknown }): string {
  const body = requireBody(request);
  const blob = requireString(body, "recoveryBlob");
  if (!BASE64_PATTERN.test(blob) || Buffer.from(blob, "base64").length !== RECOVERY_BLOB_BYTES) {
    throw new ValidationError(
      `"recoveryBlob" must be base64 encoding exactly ${RECOVERY_BLOB_BYTES} bytes`,
    );
  }
  return blob;
}

/** Validated, opaque encryption metadata from a multipart upload. */
export interface ParsedEncryption {
  format: EncryptionFormat;
  wrappedKey: string;
  metadataBlob: string;
  keyEpoch: number;
}

/**
 * An optional base64 field. Returns undefined when the field is absent, and
 * throws when it is present but is not a plausible base64 blob.
 */
export function optionalBase64Field(body: unknown, field: string, max: number): string | undefined {
  const value = optionalString(body, field);
  if (value === undefined) return undefined;
  if (!BASE64_PATTERN.test(value) || value.length < 56 || value.length > max) {
    throw new ValidationError(`"${field}" must be a base64 string of 56 to ${max} characters`);
  }
  return value;
}

function requireBase64Field(value: string | undefined, name: string, max: number): string {
  if (value === undefined) {
    throw new ValidationError(`"${name}" is required when encryption fields are present`);
  }
  if (!BASE64_PATTERN.test(value) || value.length < 56 || value.length > max) {
    throw new ValidationError(`"${name}" must be a base64 string of 56 to ${max} characters`);
  }
  return value;
}

/**
 * Parses the OCE1 encryption metadata text fields of a multipart upload. The
 * values are opaque to the server: only their presence, format identifier,
 * base64 alphabet/length and epoch range are checked. All fields absent means
 * a plaintext upload; any present field makes the full set mandatory.
 */
export function parseEncryptionFields(fields: MultipartFields): ParsedEncryption | undefined {
  const encryptionFormat = multipartTextField(fields, "encryptionFormat");
  const wrappedKey = multipartTextField(fields, "wrappedKey");
  const metadataBlob = multipartTextField(fields, "metadataBlob");
  const keyEpochRaw = multipartTextField(fields, "keyEpoch");

  if (
    encryptionFormat === undefined &&
    wrappedKey === undefined &&
    metadataBlob === undefined &&
    keyEpochRaw === undefined
  ) {
    return undefined;
  }

  // Any field present means the whole set is present, including the format.
  if (encryptionFormat === undefined || !isEncryptionFormat(encryptionFormat)) {
    throw new ValidationError(
      `encryptionFormat must be one of ${ENCRYPTION_FORMATS.map((f) => `"${f}"`).join(", ")} when encryption fields are present`,
    );
  }

  const checkedWrappedKey = requireBase64Field(wrappedKey, "wrappedKey", 4096);
  const checkedMetadataBlob = requireBase64Field(metadataBlob, "metadataBlob", 65536);

  if (keyEpochRaw === undefined || !KEY_EPOCH_PATTERN.test(keyEpochRaw)) {
    throw new ValidationError("keyEpoch must be an integer between 0 and 4294967295");
  }
  const keyEpoch = Number(keyEpochRaw);
  if (!Number.isSafeInteger(keyEpoch) || keyEpoch < 0 || keyEpoch > MAX_UINT32) {
    throw new ValidationError("keyEpoch must be an integer between 0 and 4294967295");
  }

  return {
    format: encryptionFormat,
    wrappedKey: checkedWrappedKey,
    metadataBlob: checkedMetadataBlob,
    keyEpoch,
  };
}
