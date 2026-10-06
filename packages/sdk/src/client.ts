import type {
  DeleteFolderResultDTO,
  FileDTO,
  FolderDTO,
  SearchResultDTO,
  SessionInfo,
  StorageDTO,
  TelegramVerifyResponse,
  UserDTO,
} from "@omnicloud/shared";

export class OmniCloudError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OmniCloudError";
  }
}

export interface OmniCloudClientOptions {
  /** Base URL of an OmniCloud server. Defaults to same-origin ("" is kept as-is). */
  baseUrl?: string;
  /** Custom fetch implementation (e.g. for tests). */
  fetchImpl?: typeof fetch;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface UploadOptions {
  folderId?: string | null;
  onProgress?: (progress: UploadProgress) => void;
}

export interface UploadInput {
  /** File content: a File/Blob in the browser, or a Buffer/Uint8Array in Node. */
  data: Blob | Uint8Array;
  name: string;
}

/**
 * HTTP client for an OmniCloud server.
 *
 * Works in browsers (cookie sessions, upload progress via XHR) and Node.js
 * (fetch fallback, cookie forwarding is the caller's responsibility).
 */
export class OmniCloudClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OmniCloudClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  // ── Authentication ───────────────────────────────────────────────────────

  async me(): Promise<SessionInfo> {
    return this.request("GET", "/api/auth/me");
  }

  async startTelegramLogin(phone: string): Promise<void> {
    await this.request("POST", "/api/auth/telegram/start", { phone });
  }

  async verifyTelegramCode(phone: string, code: string): Promise<TelegramVerifyResponse> {
    return this.request("POST", "/api/auth/telegram/verify", { phone, code });
  }

  async submitTelegramPassword(
    phone: string,
    password: string,
  ): Promise<{ status: "ok"; user: UserDTO }> {
    return this.request("POST", "/api/auth/telegram/password", { phone, password });
  }

  async ensureStorage(): Promise<StorageDTO> {
    const { storage } = await this.request<{ storage: StorageDTO }>("POST", "/api/storage/ensure");
    return storage;
  }

  async logout(): Promise<void> {
    await this.request("POST", "/api/auth/logout");
  }

  // ── Folders ──────────────────────────────────────────────────────────────

  async listFolders(parentId: string | null): Promise<FolderDTO[]> {
    const { folders } = await this.request<{ folders: FolderDTO[] }>(
      "GET",
      `/api/folders${parentId ? `?parentId=${encodeURIComponent(parentId)}` : ""}`,
    );
    return folders;
  }

  async folderTree(): Promise<FolderDTO[]> {
    const { folders } = await this.request<{ folders: FolderDTO[] }>("GET", "/api/folders/tree");
    return folders;
  }

  async createFolder(name: string, parentId: string | null = null): Promise<FolderDTO> {
    const { folder } = await this.request<{ folder: FolderDTO }>("POST", "/api/folders", {
      name,
      parentId,
    });
    return folder;
  }

  async renameFolder(id: string, name: string): Promise<FolderDTO> {
    const { folder } = await this.request<{ folder: FolderDTO }>("PATCH", `/api/folders/${id}`, {
      name,
    });
    return folder;
  }

  async moveFolder(id: string, parentId: string | null): Promise<FolderDTO> {
    const { folder } = await this.request<{ folder: FolderDTO }>(
      "POST",
      `/api/folders/${id}/move`,
      { parentId },
    );
    return folder;
  }

  async deleteFolder(id: string): Promise<DeleteFolderResultDTO> {
    return this.request("DELETE", `/api/folders/${id}`);
  }

  // ── Files ────────────────────────────────────────────────────────────────

  async listFiles(folderId: string | null): Promise<FileDTO[]> {
    const { files } = await this.request<{ files: FileDTO[] }>(
      "GET",
      `/api/files${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ""}`,
    );
    return files;
  }

  async getFile(id: string): Promise<FileDTO> {
    const { file } = await this.request<{ file: FileDTO }>("GET", `/api/files/${id}`);
    return file;
  }

  async renameFile(id: string, name: string): Promise<FileDTO> {
    const { file } = await this.request<{ file: FileDTO }>("PATCH", `/api/files/${id}`, { name });
    return file;
  }

  async moveFile(id: string, folderId: string | null): Promise<FileDTO> {
    const { file } = await this.request<{ file: FileDTO }>("POST", `/api/files/${id}/move`, {
      folderId,
    });
    return file;
  }

  async deleteFile(id: string): Promise<void> {
    await this.request("DELETE", `/api/files/${id}`);
  }

  /** URL of the download endpoint (usable as href for direct downloads). */
  fileDownloadUrl(id: string): string {
    return `${this.baseUrl}/api/files/${id}/download`;
  }

  /**
   * Uploads a file. Uses XMLHttpRequest when available so `onProgress`
   * works (browsers); falls back to fetch without progress in Node.
   */
  async uploadFile(input: UploadInput, options: UploadOptions = {}): Promise<FileDTO> {
    const form = new FormData();
    const blob = input.data instanceof Blob ? input.data : new Blob([new Uint8Array(input.data)]);
    form.append("file", blob, input.name);
    if (options.folderId) form.append("folderId", options.folderId);

    if (typeof XMLHttpRequest === "function") {
      return this.uploadViaXhr(form, options.onProgress);
    }
    return this.request("POST", "/api/files", form);
  }

  async search(query: string): Promise<SearchResultDTO> {
    return this.request("GET", `/api/search?q=${encodeURIComponent(query)}`);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private uploadViaXhr(
    form: FormData,
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<FileDTO> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${this.baseUrl}/api/files`);
      xhr.responseType = "json";
      xhr.withCredentials = true;
      xhr.upload.onprogress = (event) => {
        if (!onProgress) return;
        onProgress({
          loaded: event.loaded,
          total: event.total,
          percent: event.total > 0 ? Math.round((event.loaded / event.total) * 100) : 0,
        });
      };
      xhr.onload = () => {
        const body = xhr.response as {
          file?: FileDTO;
          error?: { code: string; message: string };
        } | null;
        if (xhr.status >= 200 && xhr.status < 300 && body?.file) {
          resolve(body.file);
          return;
        }
        reject(
          new OmniCloudError(
            xhr.status,
            body?.error?.code ?? "INTERNAL_ERROR",
            body?.error?.message ?? `Upload failed (${xhr.status})`,
          ),
        );
      };
      xhr.onerror = () =>
        reject(new OmniCloudError(0, "NETWORK_ERROR", "Network error during upload"));
      xhr.send(form);
    });
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const isJsonBody = body !== undefined && !(body instanceof FormData);
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: isJsonBody ? { "Content-Type": "application/json" } : undefined,
      body: body === undefined ? undefined : isJsonBody ? JSON.stringify(body) : (body as FormData),
      credentials: "include",
    });

    if (response.status === 204) return undefined as T;

    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = (data as { error?: { code: string; message: string } } | null)?.error;
      throw new OmniCloudError(
        response.status,
        error?.code ?? "INTERNAL_ERROR",
        error?.message ?? `Request failed (${response.status})`,
      );
    }
    return data as T;
  }
}
