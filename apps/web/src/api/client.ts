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
  UpdateCheckDTO,
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

/** Serializes defined query parameters into a `?a=b` suffix. */
function buildQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(key, value === null ? "" : String(value));
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

/** A Telegram login link to show as a QR code, valid until `expiresAt` (ms). */
export interface QrToken {
  url: string;
  expiresAt: number;
}

/** Result of POST /api/auth/telegram/qr/start. */
export interface QrStartResponse {
  flowId: string;
  token: QrToken;
}

/** Result of GET /api/auth/telegram/qr/status. */
export type QrPollResponse =
  | { status: "waiting"; token: QrToken }
  | { status: "ok"; user: UserDTO }
  | { status: "password_required" }
  | { status: "expired" };

/** Typed wrappers around every endpoint of the OmniCloud v0.2 API. */
export interface ApiTokenDTO {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** Returned once, when a token is created. The secret is never shown again. */
export interface ApiTokenCreatedDTO {
  id: string;
  name: string;
  createdAt: string;
  token: string;
}

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
    startQrLogin(): Promise<QrStartResponse> {
      return requestJson("POST", "/api/auth/telegram/qr/start", {});
    },
    pollQrLogin(flowId: string): Promise<QrPollResponse> {
      return requestJson(
        "GET",
        `/api/auth/telegram/qr/status?flowId=${encodeURIComponent(flowId)}`,
      );
    },
    submitQrPassword(flowId: string, password: string): Promise<{ status: "ok"; user: UserDTO }> {
      return requestJson("POST", "/api/auth/telegram/qr/password", { flowId, password });
    },
    logout(): Promise<{ ok: boolean }> {
      return requestJson("POST", "/api/auth/logout");
    },
  },

  recovery: {
    get(): Promise<{ recoveryBlob: string | null }> {
      return requestJson("GET", "/api/auth/recovery");
    },
    set(recoveryBlob: string): Promise<{ status: "ok" }> {
      return requestJson("PUT", "/api/auth/recovery", { recoveryBlob });
    },
    remove(): Promise<{ status: "ok" }> {
      return requestJson("DELETE", "/api/auth/recovery");
    },
  },

  tokens: {
    list(): Promise<{ tokens: ApiTokenDTO[] }> {
      return requestJson("GET", "/api/tokens");
    },
    create(name: string): Promise<ApiTokenCreatedDTO> {
      return requestJson("POST", "/api/tokens", { name });
    },
    revoke(id: string): Promise<void> {
      return requestEmpty("DELETE", `/api/tokens/${encodeURIComponent(id)}`);
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

  /**
   * Update availability, as last checked by the server against the npm
   * registry. The server caches the result, so polling this is cheap.
   */
  update: {
    check(): Promise<UpdateCheckDTO> {
      return requestJson("GET", "/api/update/check");
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
    } /** Makes an earlier version current again. */,
    restoreVersion(id: string, versionId: string): Promise<{ file: FileDTO }> {
      return requestJson(
        "POST",
        filePath(id, `/versions/${encodeURIComponent(versionId)}/restore`),
      );
    },
    /** Removes one historical version. The current version cannot be removed. */
    deleteVersion(id: string, versionId: string): Promise<void> {
      return requestEmpty("DELETE", filePath(id, `/versions/${encodeURIComponent(versionId)}`));
    },
    update(
      id: string,
      patch: { name?: string; starred?: boolean; metadataBlob?: string },
    ): Promise<{ file: FileDTO }> {
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
    /** Prunes version history by retention policy; the current version always survives. */
    pruneVersions(
      id: string,
      policy:
        | { policy: "KEEP_ALL" }
        | { policy: "KEEP_LATEST_N"; count: number }
        | { policy: "KEEP_FOR_DAYS"; days: number },
    ): Promise<{ removed: number }> {
      return requestJson("POST", filePath(id, "/versions/prune"), policy);
    },
    /**
     * Triggers a browser download of the file (the API sends an attachment).
     *
     * This needs a DOM to click a link in. In Node or during server rendering
     * there is none, so it says so plainly rather than failing with
     * "document is not defined".
     */
    download(id: string): void {
      if (typeof document === "undefined") {
        throw new ApiError(
          0,
          "NO_DOM",
          "Triggering a browser download needs a browser. Use the SDK's download or downloadToFile instead.",
        );
      }
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
    /** How long trashed items are kept; 0 means indefinitely. */
    retention(): Promise<{ days: number }> {
      return requestJson("GET", "/api/trash/retention");
    },
    /** Removes the caller's expired trash now. */
    purge(): Promise<{
      deletedFiles: number;
      deletedFolders: number;
      failedFiles: number;
      skippedFiles: number;
    }> {
      return requestJson("POST", "/api/trash/purge");
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
