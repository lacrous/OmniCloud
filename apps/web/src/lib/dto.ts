import type { FileDTO, FolderDTO } from "@omnicloud/shared";

/**
 * Runtime validation of API payloads.
 *
 * A response cast to a DTO without checking its fields is a lie the type
 * system cannot catch: the object would carry `undefined` where the interface
 * promises a number or a string, and the bug would surface far from its
 * cause. These parsers fail loudly instead.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/** A string, or null. `undefined` is not accepted: the field is required. */
function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

/** An optional string field: absent, null, or a string. */
function isOptionalString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || isString(value);
}

/** An optional number field: absent, null, or a finite number. */
function isOptionalNumber(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || isNumber(value);
}

/** True when every field the interface promises is present with the right type. */
export function isFileDTO(value: unknown): value is FileDTO {
  if (!isRecord(value)) return false;
  return (
    isString(value["id"]) &&
    isString(value["name"]) &&
    isNumber(value["size"]) &&
    isString(value["mimeType"]) &&
    isString(value["sha256"]) &&
    isNullableString(value["folderId"]) &&
    isBoolean(value["starred"]) &&
    isBoolean(value["trashed"]) &&
    isNullableString(value["deletedAt"]) &&
    isNumber(value["versionCount"]) &&
    isNullableString(value["currentVersionId"]) &&
    isString(value["createdAt"]) &&
    isString(value["updatedAt"]) &&
    isOptionalString(value["encryptionFormat"]) &&
    isOptionalString(value["wrappedKey"]) &&
    isOptionalString(value["metadataBlob"]) &&
    isOptionalNumber(value["keyEpoch"])
  );
}

/** True when every field the interface promises is present with the right type. */
export function isFolderDTO(value: unknown): value is FolderDTO {
  if (!isRecord(value)) return false;
  return (
    isString(value["id"]) &&
    isString(value["name"]) &&
    isNullableString(value["parentId"]) &&
    isBoolean(value["starred"]) &&
    isBoolean(value["trashed"]) &&
    isNullableString(value["deletedAt"]) &&
    isString(value["createdAt"]) &&
    isString(value["updatedAt"])
  );
}
