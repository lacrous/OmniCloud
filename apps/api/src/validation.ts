import { ValidationError } from "@omnicloud/core";

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
