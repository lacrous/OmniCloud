import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  FileService,
  FolderService,
  OmniCloudClient,
  OmniCloudError,
  SearchService,
  StorageEngine,
  TelegramStorageProvider,
  sanitizeFileName,
  sha256Hex,
} from "../src/index";

describe("@lacrous/omnicloud public API", () => {
  it("exposes the documented exports", () => {
    expect(OmniCloudClient).toBeTypeOf("function");
    expect(OmniCloudError).toBeTypeOf("function");
    expect(StorageEngine).toBeTypeOf("function");
    expect(FileService).toBeTypeOf("function");
    expect(FolderService).toBeTypeOf("function");
    expect(SearchService).toBeTypeOf("function");
    expect(TelegramStorageProvider).toBeTypeOf("function");
    expect(typeof sha256Hex).toBe("function");
    expect(typeof sanitizeFileName).toBe("function");
    expect(ERROR_CODES.UNAUTHENTICATED).toBe("UNAUTHENTICATED");
  });
});

describe("OmniCloudClient", () => {
  function clientWith(handler: (path: string, init: RequestInit) => Response) {
    return new OmniCloudClient({
      baseUrl: "http://omni.test",
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) =>
        handler(String(input), (init ?? {}) as RequestInit)) as typeof fetch,
    });
  }

  it("lists files for a folder", async () => {
    const client = clientWith((path) => {
      expect(path).toBe("http://omni.test/api/files?folderId=f1");
      return Response.json({ files: [{ id: "a", name: "a.txt" }] });
    });

    const files = await client.listFiles("f1");
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe("a.txt");
  });

  it("maps API errors to OmniCloudError", async () => {
    const client = clientWith(() =>
      Response.json({ error: { code: "NOT_FOUND", message: "File not found" } }, { status: 404 }),
    );

    await expect(client.getFile("nope")).rejects.toMatchObject({
      name: "OmniCloudError",
      status: 404,
      code: "NOT_FOUND",
    });
  });

  it("builds download URLs", () => {
    const client = clientWith(() => Response.json({}));
    expect(client.fileDownloadUrl("abc")).toBe("http://omni.test/api/files/abc/download");
  });
});
