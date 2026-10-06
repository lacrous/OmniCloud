import type {
  ApiErrorBody,
  DeleteFolderResultDTO,
  FileDTO,
  FolderDTO,
  SearchResultDTO,
  SessionInfo,
  StorageDTO,
  TelegramVerifyResponse,
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

function withQueryParam(url: string, key: string, value: string): string {
  return `${url}?${key}=${encodeURIComponent(value)}`;
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
    if (response.status === 401) notifyUnauthorized();
    throw apiErrorFromText(response.status, text);
  }
  return response;
}

async function requestJson<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await send(method, url, body);
  return (await response.json()) as T;
}

async function requestEmpty(method: string, url: string): Promise<void> {
  await send(method, url);
}

/** Typed wrappers around every endpoint of the OmniCloud API. */
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
  },
  folders: {
    list(parentId: string | null): Promise<{ folders: FolderDTO[] }> {
      return requestJson(
        "GET",
        parentId === null ? "/api/folders" : withQueryParam("/api/folders", "parentId", parentId),
      );
    },
    create(name: string, parentId: string | null): Promise<{ folder: FolderDTO }> {
      return requestJson("POST", "/api/folders", { name, parentId });
    },
    tree(): Promise<{ folders: FolderDTO[] }> {
      return requestJson("GET", "/api/folders/tree");
    },
    rename(id: string, name: string): Promise<{ folder: FolderDTO }> {
      return requestJson("PATCH", `/api/folders/${encodeURIComponent(id)}`, { name });
    },
    move(id: string, parentId: string | null): Promise<{ folder: FolderDTO }> {
      return requestJson("POST", `/api/folders/${encodeURIComponent(id)}/move`, { parentId });
    },
    delete(id: string): Promise<DeleteFolderResultDTO> {
      return requestJson("DELETE", `/api/folders/${encodeURIComponent(id)}`);
    },
  },
  files: {
    list(folderId: string | null): Promise<{ files: FileDTO[] }> {
      return requestJson(
        "GET",
        folderId === null ? "/api/files" : withQueryParam("/api/files", "folderId", folderId),
      );
    },
    rename(id: string, name: string): Promise<{ file: FileDTO }> {
      return requestJson("PATCH", `/api/files/${encodeURIComponent(id)}`, { name });
    },
    move(id: string, folderId: string | null): Promise<{ file: FileDTO }> {
      return requestJson("POST", `/api/files/${encodeURIComponent(id)}/move`, { folderId });
    },
    delete(id: string): Promise<void> {
      return requestEmpty("DELETE", `/api/files/${encodeURIComponent(id)}`);
    },
    /** Triggers a browser download of the file (the API sends an attachment). */
    download(id: string): void {
      const anchor = document.createElement("a");
      anchor.href = `/api/files/${encodeURIComponent(id)}/download`;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    },
  },
  search(query: string): Promise<SearchResultDTO> {
    return requestJson("GET", withQueryParam("/api/search", "q", query));
  },
};
