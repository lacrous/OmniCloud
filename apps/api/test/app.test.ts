import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "@omnicloud/core";
import { createTestHarness, multipartBody, type TestHarness } from "./harness";

let h: TestHarness;
let sessionCookie: string;
let secondUserCookie: string;

beforeAll(async () => {
  h = await createTestHarness();
  sessionCookie = await h.login();
  secondUserCookie = await h.login("+15559998888");
});

afterAll(async () => {
  await h?.container.shutdown();
});

function get(url: string, cookie = sessionCookie) {
  return h.app.inject({
    method: "GET",
    url,
    cookies: cookie ? { omnicloud_session: cookie } : {},
  });
}
function post(url: string, payload: Record<string, unknown>, cookie = sessionCookie) {
  return h.app.inject({
    method: "POST",
    url,
    payload,
    cookies: cookie ? { omnicloud_session: cookie } : {},
  });
}
function patch(url: string, payload: Record<string, unknown>, cookie = sessionCookie) {
  return h.app.inject({
    method: "PATCH",
    url,
    payload,
    cookies: cookie ? { omnicloud_session: cookie } : {},
  });
}
function del(url: string, cookie = sessionCookie) {
  return h.app.inject({
    method: "DELETE",
    url,
    cookies: cookie ? { omnicloud_session: cookie } : {},
  });
}

describe("authentication & authorization", () => {
  it("exposes the public session endpoint", async () => {
    const anonymous = await h.app.inject({ method: "GET", url: "/api/auth/me" });
    expect(anonymous.statusCode).toBe(200);
    expect(anonymous.json()).toEqual({ user: null, storage: null });
  });

  it("requires authentication for API endpoints", async () => {
    const response = await h.app.inject({ method: "GET", url: "/api/files" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHENTICATED");
  });

  it("requests the 2FA password when needed", async () => {
    const response = await post("/api/auth/telegram/verify", {
      phone: "+15550000001",
      code: "0000",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "password_required" });
  });

  it("returns session info for signed-in users", async () => {
    const response = await get("/api/auth/me");
    const body = response.json();
    expect(body.user).toMatchObject({ firstName: "Test" });
    expect(body.storage).toMatchObject({ provider: "telegram", title: "OmniCloud Storage" });
  });

  it("returns structured 404s for unknown routes", async () => {
    const response = await get("/api/definitely-not-a-route");
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("NOT_FOUND");
  });
});

describe("drive flow (folders, files, search, integrity)", () => {
  let documentsId: string;
  let picturesId: string;
  let testPdfId: string;

  it("creates folders", async () => {
    const documents = await post("/api/folders", { name: "Documents" });
    expect(documents.statusCode).toBe(201);
    expect(documents.json().folder.name).toBe("Documents");
    documentsId = documents.json().folder.id;

    const pictures = await post("/api/folders", { name: "Pictures" });
    picturesId = pictures.json().folder.id;
  });

  it("uploads a file into a folder and derives its metadata", async () => {
    const data = Buffer.from("hello world");
    const { payload, contentType } = multipartBody(
      { folderId: documentsId },
      {
        name: "test.pdf",
        data,
      },
    );

    const response = await h.app.inject({
      method: "POST",
      url: "/api/files",
      headers: { "content-type": contentType },
      payload,
      cookies: { omnicloud_session: sessionCookie },
    });

    expect(response.statusCode).toBe(201);
    const file = response.json().file;
    expect(file.name).toBe("test.pdf");
    expect(file.folderId).toBe(documentsId);
    expect(file.mimeType).toBe("application/pdf");
    expect(file.sha256).toBe(sha256Hex(data));
    expect(file.size).toBe(data.byteLength);
    testPdfId = file.id;
    expect(h.provider.objects.size).toBe(1);
  });

  it("lists files per folder and at root", async () => {
    const inDocuments = await get(`/api/files?folderId=${documentsId}`);
    expect(inDocuments.json().files.map((f: { id: string }) => f.id)).toEqual([testPdfId]);

    const atRoot = await get("/api/files");
    expect(atRoot.json().files).toHaveLength(0);
  });

  it("lists folders and returns the full tree", async () => {
    const rootFolders = await get("/api/folders");
    expect(
      rootFolders
        .json()
        .folders.map((f: { id: string }) => f.id)
        .sort(),
    ).toEqual([documentsId, picturesId].sort());

    const tree = await get("/api/folders/tree");
    expect(tree.json().folders).toHaveLength(2);
  });

  it("searches by filename", async () => {
    const response = await get("/api/search?q=test");
    const body = response.json();
    expect(body.files.map((f: { id: string }) => f.id)).toEqual([testPdfId]);

    const folderSearch = await get("/api/search?q=docu");
    expect(folderSearch.json().folders.map((f: { id: string }) => f.id)).toEqual([documentsId]);
  });

  it("renames a file", async () => {
    const response = await patch(`/api/files/${testPdfId}`, { name: "renamed.pdf" });
    expect(response.statusCode).toBe(200);
    expect(response.json().file.name).toBe("renamed.pdf");
  });

  it("moves a file between folders and back to root", async () => {
    const moved = await post(`/api/files/${testPdfId}/move`, { folderId: picturesId });
    expect(moved.json().file.folderId).toBe(picturesId);

    const back = await post(`/api/files/${testPdfId}/move`, { folderId: null });
    expect(back.json().file.folderId).toBeNull();
  });

  it("downloads the original bytes with integrity headers", async () => {
    const response = await get(`/api/files/${testPdfId}/download`);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("hello world");
    expect(response.headers["content-type"]).toBe("application/pdf");
    expect(response.headers["x-content-sha256"]).toBe(sha256Hex(Buffer.from("hello world")));
    expect(response.headers["x-integrity-verified"]).toBe("true");
  });

  it("deletes a file and removes the remote object", async () => {
    const objectsBefore = h.provider.objects.size;
    const response = await del(`/api/files/${testPdfId}`);
    expect(response.statusCode).toBe(204);

    const gone = await get(`/api/files/${testPdfId}`);
    expect(gone.statusCode).toBe(404);
    expect(h.provider.objects.size).toBe(objectsBefore - 1);
  });

  it("rejects moving a folder into its own descendant", async () => {
    const child = await post("/api/folders", { name: "Child", parentId: documentsId });
    const childId = child.json().folder.id;

    const response = await post(`/api/folders/${documentsId}/move`, { parentId: childId });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("deletes a folder recursively", async () => {
    const child = await post("/api/folders", { name: "Nested", parentId: documentsId });
    const nestedId = child.json().folder.id;

    const { payload, contentType } = multipartBody(
      { folderId: nestedId },
      {
        name: "nested.txt",
        data: Buffer.from("nested"),
      },
    );
    await h.app.inject({
      method: "POST",
      url: "/api/files",
      headers: { "content-type": contentType },
      payload,
      cookies: { omnicloud_session: sessionCookie },
    });

    const objectsBefore = h.provider.objects.size;
    const response = await del(`/api/folders/${documentsId}`);

    expect(response.statusCode).toBe(200);
    // Documents + Child (created in the descendant-move test) + Nested
    expect(response.json()).toEqual({ deletedFolders: 3, deletedFiles: 1 });
    expect(h.provider.objects.size).toBe(objectsBefore - 1);

    const gone = await get(`/api/folders/${nestedId}`);
    expect(gone.statusCode).toBe(404);
  });
});

describe("multi-user isolation", () => {
  let fileId: string;

  beforeAll(async () => {
    const { payload, contentType } = multipartBody(
      {},
      { name: "private.txt", data: Buffer.from("secret") },
    );
    const response = await h.app.inject({
      method: "POST",
      url: "/api/files",
      headers: { "content-type": contentType },
      payload,
      cookies: { omnicloud_session: sessionCookie },
    });
    fileId = response.json().file.id;
  });

  it("hides another user's files as 404", async () => {
    const response = await get(`/api/files/${fileId}`, secondUserCookie);
    expect(response.statusCode).toBe(404);

    const download = await get(`/api/files/${fileId}/download`, secondUserCookie);
    expect(download.statusCode).toBe(404);
  });

  it("does not leak data through search", async () => {
    const response = await get("/api/search?q=private", secondUserCookie);
    expect(response.json().files).toHaveLength(0);
  });

  it("cannot delete another user's files", async () => {
    const response = await del(`/api/files/${fileId}`, secondUserCookie);
    expect(response.statusCode).toBe(404);
  });
});

describe("uploads", () => {
  it("rejects a request without a multipart file", async () => {
    const response = await h.app.inject({
      method: "POST",
      url: "/api/files",
      headers: { "content-type": "application/json" },
      payload: {},
      cookies: { omnicloud_session: sessionCookie },
    });
    // Framework-level media-type handling; all are client errors.
    expect([400, 406, 415]).toContain(response.statusCode);
  });

  it("rejects uploads above the configured size limit", async () => {
    const big = Buffer.alloc(2 * 1024 * 1024, 1); // harness limit is 1 MB
    const { payload, contentType } = multipartBody({}, { name: "big.bin", data: big });
    const response = await h.app.inject({
      method: "POST",
      url: "/api/files",
      headers: { "content-type": contentType },
      payload,
      cookies: { omnicloud_session: sessionCookie },
    });
    expect(response.statusCode).toBe(413);
  });
});
