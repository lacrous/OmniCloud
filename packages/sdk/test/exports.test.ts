import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  FileService,
  FolderService,
  IntegrityService,
  OmniCloudClient,
  OmniCloudError,
  SearchService,
  StatsService,
  StorageEngine,
  TelegramStorageProvider,
  TrashService,
  paginationMeta,
  parseSearchQuery,
  parseSize,
  sanitizeFileName,
  sha256Hex,
} from "../src/index";

describe("@lacrous/omnicloud public API", () => {
  it("exposes the documented v0.2 exports", () => {
    expect(OmniCloudClient).toBeTypeOf("function");
    expect(OmniCloudError).toBeTypeOf("function");
    expect(StorageEngine).toBeTypeOf("function");
    expect(FileService).toBeTypeOf("function");
    expect(FolderService).toBeTypeOf("function");
    expect(SearchService).toBeTypeOf("function");
    expect(StatsService).toBeTypeOf("function");
    expect(TrashService).toBeTypeOf("function");
    expect(IntegrityService).toBeTypeOf("function");
    expect(TelegramStorageProvider).toBeTypeOf("function");
    expect(typeof sha256Hex).toBe("function");
    expect(typeof sanitizeFileName).toBe("function");
    expect(typeof parseSearchQuery).toBe("function");
    expect(typeof parseSize).toBe("function");
    expect(typeof paginationMeta).toBe("function");
    expect(ERROR_CODES.AUTH_REQUIRED).toBe("AUTH_REQUIRED");
  });

  it("constructs namespaced sub-clients", () => {
    const client = new OmniCloudClient();
    expect(client.files).toBeDefined();
    expect(client.folders).toBeDefined();
    expect(client.trash).toBeDefined();
    expect(client.storage).toBeDefined();
    expect(client.search).toBeDefined();
    expect(client.recent).toBeDefined();
    expect(client.activity).toBeDefined();
    expect(client.auth).toBeDefined();
  });
});

function clientWith(handler: (path: string, init: RequestInit) => Response) {
  return new OmniCloudClient({
    baseUrl: "http://omni.test",
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) =>
      handler(String(input), (init ?? {}) as RequestInit)) as typeof fetch,
    retry: { attempts: 1, baseDelayMs: 1 },
  });
}

describe("OmniCloudClient request building", () => {
  it("lists files with query parameters", async () => {
    const client = clientWith((path) => {
      expect(path).toContain("/api/files?");
      expect(path).toContain("folderId=f1");
      expect(path).toContain("sort=name");
      expect(path).toContain("page=2");
      return Response.json({
        files: [{ id: "a", name: "a.txt" }],
        pagination: { page: 2, limit: 50, total: 1, hasMore: false },
      });
    });

    const result = await client.files.list({ folderId: "f1", sort: "name", page: 2 });
    expect(result.files).toHaveLength(1);
    expect(result.pagination.page).toBe(2);
  });

  it("omits undefined query values", async () => {
    const client = clientWith((path) => {
      expect(path).not.toContain("undefined");
      expect(path).not.toContain("starred=");
      return Response.json({
        files: [],
        pagination: { page: 1, limit: 50, total: 0, hasMore: false },
      });
    });
    await client.files.list({ folderId: "f1", starred: undefined });
  });

  it("sends JSON bodies with the right method", async () => {
    const client = clientWith((path, init) => {
      expect(path).toBe("http://omni.test/api/folders");
      expect(init.method).toBe("POST");
      expect(JSON.parse(String(init.body))).toEqual({ name: "Docs", parentId: null });
      return Response.json({ folder: { id: "f1", name: "Docs" } }, { status: 201 });
    });

    const folder = await client.folders.create("Docs");
    expect(folder.id).toBe("f1");
  });

  it("handles 204 responses", async () => {
    const client = clientWith(() => new Response(null, { status: 204 }));
    await expect(client.files.delete("f1")).resolves.toBeUndefined();
  });

  it("maps API errors to OmniCloudError with code and requestId", async () => {
    const client = clientWith(() =>
      Response.json(
        { error: { code: "FILE_NOT_FOUND", message: "File not found", requestId: "req-1" } },
        { status: 404 },
      ),
    );

    await expect(client.files.get("nope")).rejects.toMatchObject({
      status: 404,
      code: "FILE_NOT_FOUND",
      requestId: "req-1",
    });
  });

  it("builds direct download URLs", () => {
    expect(clientWith(() => Response.json({})).files.downloadUrl("abc")).toBe(
      "http://omni.test/api/files/abc/download",
    );
  });

  it("exposes integrity metadata on downloads", async () => {
    const client = clientWith(
      () =>
        new Response("content", {
          status: 200,
          headers: {
            "content-type": "text/plain",
            "content-length": "7",
            "x-content-sha256": "abc123",
            "x-integrity-verified": "true",
          },
        }),
    );

    const result = await client.files.download("f1");
    expect(result.size).toBe(7);
    expect(result.sha256).toBe("abc123");
    expect(result.integrityVerified).toBe(true);
  });

  it("runs integrity checks through the storage namespace", async () => {
    const client = clientWith(() =>
      Response.json({
        report: { checkedAt: "now", filesChecked: 3, healthy: 3, issues: [], durationMs: 5 },
      }),
    );
    const report = await client.storage.integrityCheck({ deep: true });
    expect(report.filesChecked).toBe(3);
  });

  it("empties the trash through the trash namespace", async () => {
    const client = clientWith((path, init) => {
      expect(path).toBe("http://omni.test/api/trash/empty");
      expect(init.method).toBe("POST");
      return Response.json({ deletedFiles: 2, deletedFolders: 1, failedFiles: 0 });
    });
    expect(await client.trash.empty()).toMatchObject({ deletedFiles: 2 });
  });

  it("batch-moves files", async () => {
    const client = clientWith((path, init) => {
      expect(path).toBe("http://omni.test/api/files/batch");
      expect(JSON.parse(String(init.body))).toMatchObject({
        operation: "move",
        folderId: "dest",
      });
      return Response.json({ requested: 2, succeeded: 2, failed: 0, errors: [] });
    });
    expect(await client.files.batch("move", ["a", "b"], { folderId: "dest" })).toMatchObject({
      succeeded: 2,
    });
  });

  it("retries transient failures and then succeeds", async () => {
    let calls = 0;
    const client = new OmniCloudClient({
      baseUrl: "http://omni.test",
      fetchImpl: (async () => {
        calls += 1;
        if (calls < 3) return new Response("boom", { status: 503 });
        return Response.json({ status: "ok" });
      }) as typeof fetch,
      retry: { attempts: 3, baseDelayMs: 1 },
    });

    await expect(client.storage.serverHealth()).resolves.toMatchObject({ status: "ok" });
    expect(calls).toBe(3);
  });

  it("does not retry client errors", async () => {
    let calls = 0;
    const client = new OmniCloudClient({
      baseUrl: "http://omni.test",
      fetchImpl: (async () => {
        calls += 1;
        return Response.json(
          { error: { code: "INVALID_REQUEST", message: "nope" } },
          { status: 400 },
        );
      }) as typeof fetch,
      retry: { attempts: 5, baseDelayMs: 1 },
    });

    await expect(client.folders.create("x")).rejects.toThrow(OmniCloudError);
    expect(calls).toBe(1);
  });

  it("passes a bearer token when configured", async () => {
    const client = new OmniCloudClient({
      baseUrl: "http://omni.test",
      token: "secret-token",
      fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        expect(headers.Authorization).toBe("Bearer secret-token");
        return Response.json({ user: null, storage: null, health: null });
      }) as typeof fetch,
    });

    await client.auth.me();
  });
});
