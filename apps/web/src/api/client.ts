import { ERROR_CODES } from "@omnicloud/shared";

// Re-exported so UI code can compare against stable server error codes
// without a second import site.
export { ERROR_CODES };
import type {
  ActivityPageDTO,
  ApiErrorBody,
  BatchFileOperation,
  BatchFolderOperation,
  BatchResultDTO,
  EmptyTrashResultDTO,
  FileDTO,
  FilesPageDTO,
  FileVersionDTO,
  FolderDTO,
  FolderMutationResultDTO,
  FoldersPageDTO,
  IntegrityReportDTO,
  ItemStatus,
  RecentPageDTO,
  SearchResultDTO,
  SessionInfo,
  SortField,
  SortOrder,
  StorageDTO,
  StorageHealthDTO,
  StorageStatsDTO,
  TrashPageDTO,
  UserDTO,
} from "@omnicloud/shared";

/** Error thrown for non-2xx API responses, parsed from the structured error envelope. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** Extracts a human-readable message from an unknown error, with a fallback. */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message !== "") return error.message;
  return fallback;
}

/** True when `error` is an ApiError carrying one of `codes`. */
export function isApiError(error: unknown, ...codes: string[]): boolean {
  return error instanceof ApiError && codes.includes(error.code);
}

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

/**
 * Registers a listener invoked whenever any API call returns 401.
 * Returns an unsubscribe function.
 */
export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

export function notifyUnauthorized(): void {
  for (const listener of unauthorizedListeners) listener();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (!isRecord(value) || !isRecord(value["error"])) return false;
  const error = value["error"];
  return typeof error["code"] === "string" && typeof error["message"] === "string";
}

/** Parses an error envelope from raw response text; falls back to a generic message. */
export function apiErrorFromText(status: number, responseText: string): ApiError {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(responseText) as unknown;
  } catch {
    // Non-JSON error body — fall through to the generic message.
  }
  if (isApiErrorBody(parsed)) {
    return new ApiError(status, parsed.error.code, parsed.error.message);
  }
  return new ApiError(status, "UNKNOWN", `Request failed with status ${status}`);
}

type QueryValue = string | number | boolean | null | undefined;

/** Serializes defined (non-empty) query parameters into a `?a=b` suffix. */
function buildQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded === "" ? "" : `?${encoded}`;
}

function filePath(id: string, suffix = ""): string {
  return `/api/files/${encodeURIComponent(id)}${suffix}`;
}

function folderPath(id: string, suffix = ""): string {
  return `/api/folders/${encodeURIComponent(id)}${suffix}`;
}

async function send(method: string, url: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "Could not reach the server. Check your connection and try again.",
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const error = apiErrorFromText(response.status, text);
    // TELEGRAM_AUTH_REQUIRED (401) is a storage reconnect signal, not a lost
    // browser session — don't sign the user out for it.
    if (response.status === 401 && error.code !== ERROR_CODES.TELEGRAM_AUTH_REQUIRED) {
      notifyUnauthorized();
    }
    throw error;
  }
  return response;
}

async function requestJson<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await send(method, url, body);
  return (await response.json()) as T;
}

async function requestEmpty(method: string, url: string, body?: unknown): Promise<void> {
  await send(method, url, body);
}

/** Parameters accepted when listing files. */
export interface FileListParams {
  folderId?: string | null;
  page?: number;
  limit?: number;
  sort?: SortField;
  order?: SortOrder;
  type?: string;
  ext?: string;
  starred?: boolean;
  status?: ItemStatus;
  q?: string;
  minSize?: number;
  maxSize?: number;
  from?: string;
  to?: string;
}

/** Parameters accepted when listing folders. */
export interface FolderListParams {
  parentId?: string | null;
  page?: number;
  limit?: number;
  sort?: SortField;
  order?: SortOrder;
  status?: ItemStatus;
  starred?: boolean;
  q?: string;
}

/** Batch operations shared by the file and folder batch endpoints. */
export type BatchOperation = BatchFileOperation | BatchFolderOperation;

/** Payload for the file/folder batch endpoints. */
export interface BatchPayload {
  operation: BatchOperation;
  ids: string[];
  folderId?: string | null;
}

/** Result of POST /api/auth/telegram/verify. */
export type TelegramVerifyResponse =
  { status: "ok"; user: UserDTO } | { status: "password_required" };

/** Typed wrappers around every endpoint of the OmniCloud v0.2 API. */
export const api = {
  auth: {
    me(): Promise<SessionInfo> {
      return requestJson("GET", "/api/auth/me");
    },
    startLogin(phone: string): Promise<{ ok: boolean }> {
      return requestJson("POST", "/api/auth/telegram/start", { phone });
    },
    verifyCode(phone: string, code: string): Promise<TelegramVerifyResponse> {
      return requestJson("POST", "/api/auth/telegram/verify", { phone, code });
    },
    verifyPassword(phone: string, password: string): Promise<{ status: "ok"; user: UserDTO }> {
      return requestJson("POST", "/api/auth/telegram/password", { phone, password });
    },
    logout(): Promise<{ ok: boolean }> {
      return requestJson("POST", "/api/auth/logout");
    },
  },

  storage: {
    ensure(): Promise<{ storage: StorageDTO }> {
      return requestJson("POST", "/api/storage/ensure");
    },
    health(): Promise<{ health: StorageHealthDTO | null; stats: StorageStatsDTO }> {
      return requestJson("GET", "/api/storage/health");
    },
    stats(): Promise<{ stats: StorageStatsDTO }> {
      return requestJson("GET", "/api/storage/stats");
    },
    integrityCheck(deep = false): Promise<{ report: IntegrityReportDTO }> {
      return requestJson("POST", "/api/storage/integrity/check", deep ? { deep: true } : {});
    },
  },

  files: {
    list(params: FileListParams): Promise<FilesPageDTO> {
      return requestJson("GET", `/api/files${buildQuery({ ...params })}`);
    },
    get(id: string): Promise<{ file: FileDTO }> {
      return requestJson("GET", filePath(id));
    },
    versions(id: string): Promise<{ versions: FileVersionDTO[] }> {
      return requestJson("GET", filePath(id, "/versions"));
    },
    update(id: string, patch: { name?: string; starred?: boolean }): Promise<{ file: FileDTO }> {
      return requestJson("PATCH", filePath(id), patch);
    },
    move(id: string, folderId: string | null): Promise<{ file: FileDTO }> {
      return requestJson("POST", filePath(id, "/move"), { folderId });
    },
    trash(id: string): Promise<{ file: FileDTO }> {
      return requestJson("POST", filePath(id, "/trash"));
    },
    restore(id: string): Promise<{ file: FileDTO }> {
      return requestJson("POST", filePath(id, "/restore"));
    },
    delete(id: string): Promise<void> {
      return requestEmpty("DELETE", filePath(id));
    },
    batch(payload: BatchPayload): Promise<BatchResultDTO> {
      return requestJson("POST", "/api/files/batch", payload);
    },
    /** Triggers a browser download of the file (the API sends an attachment). */
    download(id: string): void {
      const anchor = document.createElement("a");
      anchor.href = filePath(id, "/download");
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    },
  },

  folders: {
    list(params: FolderListParams): Promise<FoldersPageDTO> {
      return requestJson("GET", `/api/folders${buildQuery({ ...params })}`);
    },
    tree(): Promise<{ folders: FolderDTO[] }> {
      return requestJson("GET", "/api/folders/tree");
    },
    create(name: string, parentId: string | null): Promise<{ folder: FolderDTO }> {
      return requestJson("POST", "/api/folders", { name, parentId });
    },
    update(
      id: string,
      patch: { name?: string; starred?: boolean },
    ): Promise<{ folder: FolderDTO }> {
      return requestJson("PATCH", folderPath(id), patch);
    },
    move(id: string, parentId: string | null): Promise<{ folder: FolderDTO }> {
      return requestJson("POST", folderPath(id, "/move"), { parentId });
    },
    trash(id: string): Promise<FolderMutationResultDTO> {
      return requestJson("POST", folderPath(id, "/trash"));
    },
    restore(id: string): Promise<FolderMutationResultDTO> {
      return requestJson("POST", folderPath(id, "/restore"));
    },
    delete(id: string): Promise<FolderMutationResultDTO> {
      return requestJson("DELETE", folderPath(id));
    },
    batch(payload: BatchPayload): Promise<BatchResultDTO> {
      return requestJson("POST", "/api/folders/batch", payload);
    },
  },

  trash: {
    list(params: { page?: number; limit?: number }): Promise<TrashPageDTO> {
      return requestJson("GET", `/api/trash${buildQuery({ ...params })}`);
    },
    empty(): Promise<EmptyTrashResultDTO> {
      return requestJson("POST", "/api/trash/empty");
    },
  },

  starred: {
    list(params: { page?: number; limit?: number; status?: ItemStatus }): Promise<{
      files: FileDTO[];
      folders: FolderDTO[];
      pagination: FilesPageDTO["pagination"];
    }> {
      return requestJson("GET", `/api/starred${buildQuery({ ...params })}`);
    },
  },

  recent: {
    list(params: { page?: number; limit?: number }): Promise<RecentPageDTO> {
      return requestJson("GET", `/api/recent${buildQuery({ ...params })}`);
    },
  },

  search: {
    query(q: string, params: { page?: number; limit?: number } = {}): Promise<SearchResultDTO> {
      return requestJson("GET", `/api/search${buildQuery({ q, ...params })}`);
    },
  },

  activity: {
    list(params: { page?: number; limit?: number }): Promise<ActivityPageDTO> {
      return requestJson("GET", `/api/activity${buildQuery({ ...params })}`);
    },
  },
};
