import type {
  ActivityPageDTO,
  BatchResultDTO,
  FolderMutationResultDTO,
  EmptyTrashResultDTO,
  FileDTO,
  FileVersionDTO,
  FoldersPageDTO,
  FilesPageDTO,
  FolderDTO,
  HealthDTO,
  IntegrityReportDTO,
  ListQuery,
  RecentPageDTO,
  SearchResultDTO,
  SessionInfo,
  StorageDTO,
  StorageHealthDTO,
  StorageStatsDTO,
  TelegramVerifyResponse,
  TrashPageDTO,
  UserDTO,
} from "@omnicloud/shared";

/**
 * Errors surfaced by the SDK. `code` mirrors the server's stable error codes
 * and `requestId` correlates with server logs.
 */
export class OmniCloudError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId: string | undefined = undefined,
    public readonly details: unknown = undefined,
  ) {
    super(message);
    this.name = "OmniCloudError";
  }
}

export interface RetryOptions {
  /** Total attempts including the first. Default 3. */
  attempts?: number;
  /** Base backoff in ms (doubles per retry). Default 300. */
  baseDelayMs?: number;
}

export interface OmniCloudClientOptions {
  /** Base URL of an OmniCloud server (e.g. "https://cloud.example"). */
  baseUrl?: string;
  /** Bearer token, when the deployment uses token auth instead of cookies. */
  token?: string;
  /** Custom fetch implementation (tests, polyfills). */
  fetchImpl?: typeof fetch;
  /** Retry policy for transient failures. */
  retry?: RetryOptions;
  /** Extra headers sent with every request. */
  headers?: Record<string, string>;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface UploadOptions {
  folderId?: string | null;
  onProgress?: (progress: UploadProgress) => void;
  /** Aborts the upload. */
  signal?: AbortSignal;
  /** Number of retry attempts for failed uploads. Default 2. */
  retry?: number;
}

export interface UploadInput {
  /** File content: Blob/File in the browser, Buffer/Uint8Array in Node. */
  data: Blob | Uint8Array;
  /** Filename; also used to derive the MIME type server-side. */
  name: string;
}

export interface DownloadProgress {
  loaded: number;
  total: number | null;
  percent: number | null;
}

export interface DownloadResult {
  data: Buffer | Uint8Array;
  contentType: string;
  size: number;
  sha256: string | null;
  integrityVerified: boolean | null;
}

type Query = Record<string, string | number | boolean | undefined | null>;

const DEFAULT_RETRY: Required<RetryOptions> = { attempts: 3, baseDelayMs: 300 };

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new OmniCloudError(0, "ABORTED", "Request aborted"));
      },
      { once: true },
    );
  });
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** Builds a query string, skipping undefined/null/empty values. */
function buildQuery(query: Query | ListQuery | undefined): string {
  const params = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      params.set(key, String(value));
    }
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Naming: every endpoint group is a namespaced sub-client so calls read like
 *
 *   cloud.files.list({ folderId })
 *   cloud.trash.empty()
 *   cloud.storage.stats()
 *
 * Works in browsers (cookie sessions, XHR upload progress) and Node
 * (fetch, Buffer downloads).
 */
export class OmniCloudClient {
  readonly files: FilesApi;
  readonly folders: FoldersApi;
  readonly trash: TrashApi;
  readonly storage: StorageApi;
  readonly search: SearchApi;
  readonly recent: RecentApi;
  readonly activity: ActivityApi;
  readonly auth: AuthApi;

  /** @internal */
  readonly baseUrl: string;
  /** @internal */
  readonly fetchImpl: typeof fetch;
  /** @internal */
  readonly retry: Required<RetryOptions>;
  /** @internal */
  readonly defaultHeaders: Record<string, string>;

  constructor(options: OmniCloudClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.retry = { ...DEFAULT_RETRY, ...options.retry };
    this.defaultHeaders = {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    };

    this.files = new FilesApi(this);
    this.folders = new FoldersApi(this);
    this.trash = new TrashApi(this);
    this.storage = new StorageApi(this);
    this.search = new SearchApi(this);
    this.recent = new RecentApi(this);
    this.activity = new ActivityApi(this);
    this.auth = new AuthApi(this);
  }

  /** Low-level request helper (retries transient failures). */
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.withRetry(async () => this.rawRequest<T>(method, path, body));
  }

  /** @internal */
  async rawRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...this.defaultHeaders,
        ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      credentials: "include",
    });

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    const data: unknown = text ? safeJsonParse(text) : null;

    if (!response.ok) {
      const error = (
        data as {
          error?: { code: string; message: string; requestId?: string; details?: unknown };
        } | null
      )?.error;
      throw new OmniCloudError(
        response.status,
        error?.code ?? "INTERNAL_ERROR",
        error?.message ?? `Request failed (${response.status})`,
        error?.requestId,
        error?.details,
      );
    }
    return data as T;
  }

  /** @internal */
  async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    const { attempts, baseDelayMs } = this.retry;
    let lastError: unknown;
    for (let attempt = 1; attempt <= Math.max(1, attempts); attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const retryable = error instanceof OmniCloudError && isRetryableStatus(error.status);
        if (!retryable || attempt >= attempts) break;
        await sleep(baseDelayMs * 2 ** (attempt - 1));
      }
    }
    throw lastError;
  }

  /** @internal */
  async requestBinary(
    path: string,
    onProgress?: (p: DownloadProgress) => void,
  ): Promise<DownloadResult> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: this.defaultHeaders,
      credentials: "include",
    });

    if (!response.ok) {
      const text = await response.text();
      const error = (safeJsonParse(text) as { error?: { code: string; message: string } } | null)
        ?.error;
      throw new OmniCloudError(
        response.status,
        error?.code ?? "DOWNLOAD_FAILED",
        error?.message ?? `Download failed (${response.status})`,
      );
    }

    const total = Number(response.headers.get("content-length") ?? 0) || null;
    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    const sha256 = response.headers.get("x-content-sha256");
    const integrityHeader = response.headers.get("x-integrity-verified");
    const integrityVerified = integrityHeader === null ? null : integrityHeader === "true";

    const data = await readBody(response, total, onProgress);
    return { data, contentType, size: data.byteLength, sha256, integrityVerified };
  }
}

/** Reads a response body, reporting progress when the platform exposes it. */
async function readBody(
  response: Response,
  total: number | null,
  onProgress?: (p: DownloadProgress) => void,
): Promise<Buffer | Uint8Array> {
  const body = response.body;
  if (!body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    onProgress?.({ loaded: buffer.byteLength, total: buffer.byteLength, percent: 100 });
    return buffer;
  }

  const chunks: Uint8Array[] = [];
  let loaded = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.({
        loaded,
        total,
        percent: total ? Math.round((loaded / total) * 100) : null,
      });
    }
  }

  if (total !== null && loaded !== total) {
    throw new OmniCloudError(
      0,
      "DOWNLOAD_INCOMPLETE",
      `Download ended after ${loaded} of ${total} bytes`,
    );
  }

  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // Prefer Buffer in Node so callers can use Buffer APIs.
  const BufferCtor = (globalThis as { Buffer?: typeof Buffer }).Buffer;
  return BufferCtor ? BufferCtor.from(merged) : merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// Namespaced APIs
// ─────────────────────────────────────────────────────────────────────────────

class FilesApi {
  constructor(private readonly client: OmniCloudClient) {}

  /** `folderId: null` = root; omit it to list every active file. */
  async list(query: ListQuery = {}): Promise<FilesPageDTO> {
    return this.client.request<FilesPageDTO>("GET", `/api/files${buildQuery(query)}`);
  }

  async get(id: string): Promise<FileDTO> {
    const { file } = await this.client.request<{ file: FileDTO }>("GET", `/api/files/${id}`);
    return file;
  }

  async versions(id: string): Promise<FileVersionDTO[]> {
    const { versions } = await this.client.request<{ versions: FileVersionDTO[] }>(
      "GET",
      `/api/files/${id}/versions`,
    );
    return versions;
  }

  /**
   * Uploads a file with progress and retry support. Uses XMLHttpRequest when
   * available (browsers) so progress and cancellation work; falls back to
   * fetch elsewhere.
   */
  async upload(input: UploadInput, options: UploadOptions = {}): Promise<FileDTO> {
    const attempts = Math.max(1, (options.retry ?? 2) + 1);
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.uploadOnce(input, options);
      } catch (error) {
        lastError = error;
        if (options.signal?.aborted) throw error;
        if (error instanceof OmniCloudError && !isRetryableStatus(error.status)) throw error;
        if (attempt < attempts) await sleep(300 * 2 ** (attempt - 1), options.signal);
      }
    }
    throw lastError;
  }

  private uploadOnce(input: UploadInput, options: UploadOptions): Promise<FileDTO> {
    const form = new FormData();
    const blob =
      typeof Blob !== "undefined" && input.data instanceof Blob
        ? input.data
        : new Blob([new Uint8Array(input.data as Uint8Array)]);
    form.append("file", blob, input.name);
    if (options.folderId) form.append("folderId", options.folderId);

    if (typeof XMLHttpRequest === "function") {
      return this.uploadViaXhr(form, options);
    }
    return this.client
      .request<{ file: FileDTO }>("POST", "/api/files", form)
      .then((response) => response.file);
  }

  private uploadViaXhr(form: FormData, options: UploadOptions): Promise<FileDTO> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${this.client.baseUrl}/api/files`);
      xhr.responseType = "json";
      xhr.withCredentials = true;

      const onAbort = () => xhr.abort();
      options.signal?.addEventListener("abort", onAbort, { once: true });

      xhr.upload.onprogress = (event) => {
        options.onProgress?.({
          loaded: event.loaded,
          total: event.total,
          percent: event.total > 0 ? Math.round((event.loaded / event.total) * 100) : 0,
        });
      };
      xhr.onload = () => {
        options.signal?.removeEventListener("abort", onAbort);
        const body = xhr.response as {
          file?: FileDTO;
          error?: { code: string; message: string; requestId?: string };
        } | null;
        if (xhr.status >= 200 && xhr.status < 300 && body?.file) {
          options.onProgress?.({ loaded: 1, total: 1, percent: 100 });
          resolve(body.file);
          return;
        }
        reject(
          new OmniCloudError(
            xhr.status,
            body?.error?.code ?? "UPLOAD_FAILED",
            body?.error?.message ?? `Upload failed (${xhr.status})`,
            body?.error?.requestId,
          ),
        );
      };
      xhr.onerror = () =>
        reject(new OmniCloudError(0, "NETWORK_ERROR", "Network error during upload"));
      xhr.onabort = () => reject(new OmniCloudError(0, "ABORTED", "Upload aborted"));
      xhr.send(form);
    });
  }

  /** Uploads a new version of an existing file. */
  async replace(id: string, input: UploadInput): Promise<FileDTO> {
    const form = new FormData();
    const blob =
      typeof Blob !== "undefined" && input.data instanceof Blob
        ? input.data
        : new Blob([new Uint8Array(input.data as Uint8Array)]);
    form.append("file", blob, input.name);
    const { file } = await this.client.request<{ file: FileDTO }>(
      "POST",
      `/api/files/${id}/replace`,
      form,
    );
    return file;
  }

  async download(id: string, onProgress?: (p: DownloadProgress) => void): Promise<DownloadResult> {
    return this.client.requestBinary(`/api/files/${id}/download`, onProgress);
  }

  /** URL suitable for direct download (anchor href). */
  downloadUrl(id: string): string {
    return `${this.client.baseUrl}/api/files/${id}/download`;
  }

  async rename(id: string, name: string): Promise<FileDTO> {
    const { file } = await this.client.request<{ file: FileDTO }>("PATCH", `/api/files/${id}`, {
      name,
    });
    return file;
  }

  async star(id: string, starred = true): Promise<FileDTO> {
    const { file } = await this.client.request<{ file: FileDTO }>("PATCH", `/api/files/${id}`, {
      starred,
    });
    return file;
  }

  async move(id: string, folderId: string | null): Promise<FileDTO> {
    const { file } = await this.client.request<{ file: FileDTO }>("POST", `/api/files/${id}/move`, {
      folderId,
    });
    return file;
  }

  async trash(id: string): Promise<FileDTO> {
    const { file } = await this.client.request<{ file: FileDTO }>("POST", `/api/files/${id}/trash`);
    return file;
  }

  async restore(id: string): Promise<FileDTO> {
    const { file } = await this.client.request<{ file: FileDTO }>(
      "POST",
      `/api/files/${id}/restore`,
    );
    return file;
  }

  /** Permanently deletes a file and its Telegram objects. */
  async delete(id: string): Promise<void> {
    await this.client.request<void>("DELETE", `/api/files/${id}`);
  }

  /** Batch operation: trash | restore | delete | star | unstar | move. */
  async batch(
    operation: "trash" | "restore" | "delete" | "star" | "unstar" | "move",
    ids: string[],
    options: { folderId?: string | null } = {},
  ): Promise<BatchResultDTO> {
    return this.client.request<BatchResultDTO>("POST", "/api/files/batch", {
      operation,
      ids,
      ...(operation === "move" ? { folderId: options.folderId ?? null } : {}),
    });
  }
}

class FoldersApi {
  constructor(private readonly client: OmniCloudClient) {}

  async list(query: ListQuery & { parentId?: string | null } = {}): Promise<FoldersPageDTO> {
    const { parentId, ...rest } = query;
    const path =
      parentId !== undefined
        ? `/api/folders?parentId=${encodeURIComponent(parentId ?? "")}`
        : `/api/folders${buildQuery(rest)}`;
    return this.client.request<FoldersPageDTO>("GET", path);
  }

  /** The full active folder tree (for move dialogs). */
  async tree(): Promise<FolderDTO[]> {
    const { folders } = await this.client.request<{ folders: FolderDTO[] }>(
      "GET",
      "/api/folders/tree",
    );
    return folders;
  }

  async create(name: string, parentId: string | null = null): Promise<FolderDTO> {
    const { folder } = await this.client.request<{ folder: FolderDTO }>("POST", "/api/folders", {
      name,
      parentId,
    });
    return folder;
  }

  async rename(id: string, name: string): Promise<FolderDTO> {
    const { folder } = await this.client.request<{ folder: FolderDTO }>(
      "PATCH",
      `/api/folders/${id}`,
      { name },
    );
    return folder;
  }

  async star(id: string, starred = true): Promise<FolderDTO> {
    const { folder } = await this.client.request<{ folder: FolderDTO }>(
      "PATCH",
      `/api/folders/${id}`,
      { starred },
    );
    return folder;
  }

  async move(id: string, parentId: string | null): Promise<FolderDTO> {
    const { folder } = await this.client.request<{ folder: FolderDTO }>(
      "POST",
      `/api/folders/${id}/move`,
      { parentId },
    );
    return folder;
  }

  async trash(id: string): Promise<FolderMutationResultDTO> {
    return this.client.request<FolderMutationResultDTO>("POST", `/api/folders/${id}/trash`);
  }

  async restore(id: string): Promise<FolderMutationResultDTO> {
    return this.client.request<FolderMutationResultDTO>("POST", `/api/folders/${id}/restore`);
  }

  /** Permanently deletes the folder subtree and its Telegram objects. */
  async delete(id: string): Promise<FolderMutationResultDTO> {
    return this.client.request<FolderMutationResultDTO>("DELETE", `/api/folders/${id}`);
  }

  async batch(
    operation: "trash" | "restore" | "delete" | "star" | "unstar" | "move",
    ids: string[],
    options: { parentId?: string | null } = {},
  ): Promise<BatchResultDTO> {
    return this.client.request<BatchResultDTO>("POST", "/api/folders/batch", {
      operation,
      ids,
      ...(operation === "move" ? { parentId: options.parentId ?? null } : {}),
    });
  }
}

class TrashApi {
  constructor(private readonly client: OmniCloudClient) {}

  async list(query: ListQuery = {}): Promise<TrashPageDTO> {
    return this.client.request<TrashPageDTO>("GET", `/api/trash${buildQuery(query)}`);
  }

  /** Permanently removes everything in the Trash. */
  async empty(): Promise<EmptyTrashResultDTO> {
    return this.client.request<EmptyTrashResultDTO>("POST", "/api/trash/empty");
  }
}

class StorageApi {
  constructor(private readonly client: OmniCloudClient) {}

  /** Creates the private storage channel if it does not exist yet. */
  async ensure(): Promise<StorageDTO> {
    const { storage } = await this.client.request<{ storage: StorageDTO }>(
      "POST",
      "/api/storage/ensure",
    );
    return storage;
  }

  async stats(): Promise<StorageStatsDTO> {
    const { stats } = await this.client.request<{ stats: StorageStatsDTO }>(
      "GET",
      "/api/storage/stats",
    );
    return stats;
  }

  async health(): Promise<{ health: StorageHealthDTO; stats: StorageStatsDTO }> {
    return this.client.request("GET", "/api/storage/health");
  }

  /** Probes the storage backend; `deep` performs a real Telegram round-trip. */
  async check(deep = false): Promise<StorageHealthDTO> {
    const { health } = await this.client.request<{ health: StorageHealthDTO }>(
      "POST",
      "/api/storage/health/check",
      { deep },
    );
    return health;
  }

  /** Read-only integrity scan; nothing is repaired or deleted. */
  async integrityCheck(options: { deep?: boolean } = {}): Promise<IntegrityReportDTO> {
    const { report } = await this.client.request<{ report: IntegrityReportDTO }>(
      "POST",
      "/api/storage/integrity/check",
      { deep: options.deep ?? false },
    );
    return report;
  }

  /** Public server health (no authentication required). */
  async serverHealth(): Promise<HealthDTO> {
    return this.client.request<HealthDTO>("GET", "/api/health");
  }
}

class SearchApi {
  constructor(private readonly client: OmniCloudClient) {}

  /**
   * Searches with the v0.2 query language:
   *   `type:pdf`, `size:>100MB`, `folder:Projects`, `starred:true`, `after:2026-01-01`
   */
  async query(q: string, page: { page?: number; limit?: number } = {}): Promise<SearchResultDTO> {
    return this.client.request<SearchResultDTO>(
      "GET",
      `/api/search${buildQuery({ q, ...page } as Query)}`,
    );
  }
}

class RecentApi {
  constructor(private readonly client: OmniCloudClient) {}

  async list(page: { page?: number; limit?: number } = {}): Promise<RecentPageDTO> {
    return this.client.request<RecentPageDTO>("GET", `/api/recent${buildQuery(page as Query)}`);
  }
}

class ActivityApi {
  constructor(private readonly client: OmniCloudClient) {}

  async list(page: { page?: number; limit?: number } = {}): Promise<ActivityPageDTO> {
    return this.client.request<ActivityPageDTO>("GET", `/api/activity${buildQuery(page as Query)}`);
  }
}

class AuthApi {
  constructor(private readonly client: OmniCloudClient) {}

  async me(): Promise<SessionInfo> {
    return this.client.request<SessionInfo>("GET", "/api/auth/me");
  }

  async startTelegramLogin(phone: string): Promise<void> {
    await this.client.request("POST", "/api/auth/telegram/start", { phone });
  }

  async verifyTelegramCode(phone: string, code: string): Promise<TelegramVerifyResponse> {
    return this.client.request<TelegramVerifyResponse>("POST", "/api/auth/telegram/verify", {
      phone,
      code,
    });
  }

  async submitTelegramPassword(
    phone: string,
    password: string,
  ): Promise<{ status: "ok"; user: UserDTO }> {
    return this.client.request("POST", "/api/auth/telegram/password", { phone, password });
  }

  async logout(): Promise<void> {
    await this.client.request("POST", "/api/auth/logout");
  }
}
