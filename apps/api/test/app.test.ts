import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

const cookies = (cookie = sessionCookie) => ({ omnicloud_session: cookie });

function get(url: string, cookie = sessionCookie) {
  return h.app.inject({ method: "GET", url, cookies: cookies(cookie) });
}
function post(url: string, payload: Record<string, unknown> = {}, cookie = sessionCookie) {
  return h.app.inject({ method: "POST", url, payload, cookies: cookies(cookie) });
}
function patch(url: string, payload: Record<string, unknown>, cookie = sessionCookie) {
  return h.app.inject({ method: "PATCH", url, payload, cookies: cookies(cookie) });
}
function del(url: string, cookie = sessionCookie) {
  return h.app.inject({ method: "DELETE", url, cookies: cookies(cookie) });
}
async function upload(name: string, data: string, folderId?: string, cookie = sessionCookie) {
  const body = multipartBody(folderId ? { folderId } : {}, { name, data: Buffer.from(data) });
  return h.app.inject({
    method: "POST",
    url: "/api/files",
    headers: { "content-type": body.contentType },
    payload: body.payload,
    cookies: cookies(cookie),
  });
}

describe("health & security middleware", () => {
  it("exposes unauthenticated health probes", async () => {
    const health = await h.app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({
      status: "healthy",
      database: "healthy",
      version: "0.2.9",
    });

    const db = await h.app.inject({ method: "GET", url: "/api/health/database" });
    expect(db.json()).toMatchObject({ database: "healthy" });
  });

  it("sets security headers and echoes a request id", async () => {
    const response = await h.app.inject({ method: "GET", url: "/api/health" });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["x-request-id"]).toBeTruthy();
  });

  it("honors an inbound request id", async () => {
    const response = await h.app.inject({
      method: "GET",
      url: "/api/health",
      headers: { "x-request-id": "trace-abc-123" },
    });
    expect(response.headers["x-request-id"]).toBe("trace-abc-123");
  });

  it("includes the request id in error bodies", async () => {
    const response = await h.app.inject({ method: "GET", url: "/api/files" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toMatchObject({ code: "AUTH_REQUIRED" });
    expect(response.json().error.requestId).toBeTruthy();
  });

  it("rejects cross-origin state-changing requests", async () => {
    const response = await h.app.inject({
      method: "POST",
      url: "/api/folders",
      payload: { name: "Evil" },
      cookies: cookies(),
      headers: { origin: "https://evil.example", host: "localhost" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("PERMISSION_DENIED");
  });
});

describe("auth", () => {
  it("returns nulls for anonymous /me", async () => {
    const response = await h.app.inject({ method: "GET", url: "/api/auth/me" });
    expect(response.json()).toEqual({ user: null, storage: null, health: null });
  });

  it("returns session, storage and health for signed-in users", async () => {
    const response = await get("/api/auth/me");
    const body = response.json();
    expect(body.user).toMatchObject({ firstName: "Test" });
    expect(body.storage).toMatchObject({ provider: "telegram" });
    expect(body.health).toMatchObject({ state: "CONNECTED", status: "healthy" });
  });

  it("supports the 2FA password step", async () => {
    const response = await h.app.inject({
      method: "POST",
      url: "/api/auth/telegram/verify",
      payload: { phone: "+15550000001", code: "0000" },
    });
    expect(response.json()).toEqual({ status: "password_required" });
  });
});

describe("E2E: the complete v0.2 user journey", () => {
  let projectsId: string;
  let fileId: string;

  it("creates a folder", async () => {
    const response = await post("/api/folders", { name: "Projects" });
    expect(response.statusCode).toBe(201);
    expect(response.json().folder).toMatchObject({
      name: "Projects",
      starred: false,
      trashed: false,
    });
    projectsId = response.json().folder.id;
  });

  it("uploads a file with progress-capable metadata", async () => {
    const response = await upload("project.zip", "zip-content-here", projectsId);
    expect(response.statusCode).toBe(201);
    const file = response.json().file;
    expect(file).toMatchObject({ name: "project.zip", folderId: projectsId, versionCount: 1 });
    expect(file.sha256).toHaveLength(64);
    fileId = file.id;
  });

  it("lists it inside the folder and hides it from root", async () => {
    const inFolder = await get(`/api/files?folderId=${projectsId}`);
    expect(inFolder.json().files.map((f: { id: string }) => f.id)).toEqual([fileId]);
    expect(inFolder.json().pagination).toMatchObject({ page: 1, total: 1, hasMore: false });

    const atRoot = await get("/api/files?folderId=");
    expect(atRoot.json().files).toHaveLength(0);
  });

  it("searches for it", async () => {
    const response = await get("/api/search?q=project");
    expect(response.json().files.map((f: { id: string }) => f.id)).toEqual([fileId]);

    const byType = await get("/api/search?q=type:archive");
    expect(byType.json().files.map((f: { id: string }) => f.id)).toEqual([fileId]);
  });

  it("renames it", async () => {
    const response = await patch(`/api/files/${fileId}`, { name: "renamed.zip" });
    expect(response.json().file.name).toBe("renamed.zip");
  });

  it("moves it to root, then back into the folder", async () => {
    expect(
      (await post(`/api/files/${fileId}/move`, { folderId: null })).json().file.folderId,
    ).toBeNull();
    expect(
      (await post(`/api/files/${fileId}/move`, { folderId: projectsId })).json().file.folderId,
    ).toBe(projectsId);
  });

  it("stars it and finds it under /starred", async () => {
    const starred = await patch(`/api/files/${fileId}`, { starred: true });
    expect(starred.json().file.starred).toBe(true);

    const list = await get("/api/starred");
    expect(list.json().files.map((f: { id: string }) => f.id)).toEqual([fileId]);
  });

  it("appears in the recent feed", async () => {
    const response = await get("/api/recent");
    expect(response.json().items.map((i: { file: { id: string } }) => i.file.id)).toContain(fileId);
    expect(response.json().items[0].lastAction).toBeTruthy();
  });

  it("streams the file with its stored checksum and length", async () => {
    const response = await get(`/api/files/${fileId}/download`);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("zip-content-here");
    expect(response.headers["content-length"]).toBe(String(Buffer.byteLength("zip-content-here")));
    expect(response.headers["x-content-sha256"]).toBe(
      createHash("sha256").update("zip-content-here").digest("hex"),
    );
  });

  it("never delivers bytes that fail the stored checksum", async () => {
    const uploaded = await upload("tamper.txt", "genuine-bytes");
    const id = uploaded.json().file.id;
    const messageId = [...h.provider.objects.keys()].find(
      (key) => h.provider.objects.get(key)!.name === "tamper.txt",
    )!;
    h.provider.objects.set(messageId, {
      name: "tamper.txt",
      mimeType: "text/plain",
      data: Buffer.from("tampered-bytes"),
    });

    const response = await get(`/api/files/${id}/download`).catch(() => null);
    expect(response?.body ?? "").not.toBe("tampered-bytes");

    await del(`/api/files/${id}`);
  });

  it("records activity events", async () => {
    const response = await get("/api/activity");
    const actions = response.json().events.map((e: { action: string }) => e.action);
    expect(actions).toContain("upload");
    expect(actions).toContain("download");
    expect(actions).toContain("rename");
  });

  it("moves it to trash and shows it under /trash", async () => {
    const trashed = await post(`/api/files/${fileId}/trash`);
    expect(trashed.json().file.trashed).toBe(true);

    const trash = await get("/api/trash");
    expect(trash.json().files.map((f: { id: string }) => f.id)).toEqual([fileId]);

    const active = await get(`/api/files?folderId=${projectsId}`);
    expect(active.json().files).toHaveLength(0);
  });

  it("restores it from trash", async () => {
    const restored = await post(`/api/files/${fileId}/restore`);
    expect(restored.json().file.trashed).toBe(false);

    expect((await get("/api/trash")).json().files).toHaveLength(0);
  });

  it("uploads a new version (replace)", async () => {
    const body = multipartBody(
      {},
      { name: "renamed.zip", data: Buffer.from("version-two-content") },
    );
    const response = await h.app.inject({
      method: "POST",
      url: `/api/files/${fileId}/replace`,
      headers: { "content-type": body.contentType },
      payload: body.payload,
      cookies: cookies(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().file.versionCount).toBe(2);

    const versions = await get(`/api/files/${fileId}/versions`);
    expect(versions.json().versions).toHaveLength(2);
    expect(versions.json().versions.find((v: { isCurrent: boolean }) => v.isCurrent)).toMatchObject(
      { versionNumber: 2 },
    );
  });

  it("deletes it permanently and removes the remote objects", async () => {
    const objectsBefore = h.provider.objects.size;
    const response = await del(`/api/files/${fileId}`);
    expect(response.statusCode).toBe(204);

    expect((await get(`/api/files/${fileId}`)).statusCode).toBe(404);
    expect(h.provider.objects.size).toBe(objectsBefore - 2); // both versions
  });

  it("restores the ZIP category search to empty", async () => {
    const response = await get("/api/search?q=type:archive");
    expect(response.json().files).toHaveLength(0);
  });
});

describe("folder trash cascade & empty trash", () => {
  it("trashes a folder subtree, restores it, then empties the trash", async () => {
    const folder = await post("/api/folders", { name: "Cascade" });
    const folderId = folder.json().folder.id;
    const child = await post("/api/folders", { name: "Nested", parentId: folderId });
    const childId = child.json().folder.id;

    await upload("a.txt", "a", folderId);
    await upload("b.txt", "b", childId);

    const trashed = await post(`/api/folders/${folderId}/trash`);
    expect(trashed.json()).toEqual({ affectedFolders: 2, affectedFiles: 2 });

    const trash = await get("/api/trash");
    expect(trash.json().folders).toHaveLength(2);
    expect(trash.json().files).toHaveLength(2);

    const restored = await post(`/api/folders/${folderId}/restore`);
    expect(restored.json()).toEqual({ affectedFolders: 2, affectedFiles: 2 });
    expect((await get("/api/trash")).json().files).toHaveLength(0);

    await post(`/api/folders/${folderId}/trash`);
    const objectsBefore = h.provider.objects.size;
    const emptied = await post("/api/trash/empty");
    expect(emptied.json()).toMatchObject({ deletedFiles: 2, deletedFolders: 2, failedFiles: 0 });
    expect(h.provider.objects.size).toBe(objectsBefore - 2);
    expect((await get(`/api/folders/${childId}`)).statusCode).toBe(404);
  });
});

describe("batch operations", () => {
  it("batch-stars, then batch-trashes and batch-restores files", async () => {
    const a = (await upload("batch-a.txt", "a")).json().file;
    const b = (await upload("batch-b.txt", "b")).json().file;

    const starred = await post("/api/files/batch", { operation: "star", ids: [a.id, b.id] });
    expect(starred.json()).toMatchObject({ requested: 2, succeeded: 2, failed: 0 });

    expect(
      (await post("/api/files/batch", { operation: "trash", ids: [a.id, b.id] })).json().succeeded,
    ).toBe(2);
    expect(
      (await post("/api/files/batch", { operation: "restore", ids: [a.id, b.id] })).json()
        .succeeded,
    ).toBe(2);
    expect(
      (await post("/api/files/batch", { operation: "unstar", ids: [a.id, b.id] })).json().succeeded,
    ).toBe(2);

    await post("/api/files/batch", { operation: "delete", ids: [a.id, b.id] });
  });

  it("reports per-item failures instead of aborting the batch", async () => {
    const a = (await upload("partial.txt", "a")).json().file;
    const response = await post("/api/files/batch", {
      operation: "trash",
      ids: [a.id, "missing-id"],
    });
    expect(response.json()).toMatchObject({ requested: 2, succeeded: 1, failed: 1 });
    expect(response.json().errors[0].id).toBe("missing-id");
  });

  it("rejects an invalid batch operation", async () => {
    const response = await post("/api/files/batch", { operation: "explode", ids: ["x"] });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_REQUEST");
  });

  it("batch-trashes and restores folders", async () => {
    const f1 = (await post("/api/folders", { name: "BatchF1" })).json().folder;
    const f2 = (await post("/api/folders", { name: "BatchF2" })).json().folder;

    const trashed = await post("/api/folders/batch", { operation: "trash", ids: [f1.id, f2.id] });
    expect(trashed.json().succeeded).toBe(2);

    const restored = await post("/api/folders/batch", {
      operation: "restore",
      ids: [f1.id, f2.id],
    });
    expect(restored.json().succeeded).toBe(2);

    await post("/api/folders/batch", { operation: "delete", ids: [f1.id, f2.id] });
  });
});

describe("storage dashboard", () => {
  it("returns stats and health", async () => {
    const response = await get("/api/storage/health");
    const body = response.json();
    expect(body.health).toMatchObject({
      provider: "telegram",
      state: "CONNECTED",
      status: "healthy",
    });
    expect(body.stats).toHaveProperty("fileCount");
    expect(body.stats).toHaveProperty("totalBytes");
    expect(Array.isArray(body.stats.byType)).toBe(true);
  });

  it("aggregates stats by type", async () => {
    await upload("stats.pdf", "pdf-bytes");
    await upload("stats.png", "png-bytes");

    const stats = (await get("/api/storage/stats")).json().stats;
    const categories = stats.byType.map((t: { category: string }) => t.category);
    expect(categories).toContain("pdf");
    expect(categories).toContain("image");
    expect(stats.largestFiles.length).toBeGreaterThan(0);
    expect(stats.totalBytes).toBeGreaterThan(0);
  });

  it("runs a read-only integrity check", async () => {
    const report = (await post("/api/storage/integrity/check", {})).json().report;
    expect(report.filesChecked).toBeGreaterThan(0);
    expect(report.healthy).toBe(report.filesChecked);
    expect(report.issues).toHaveLength(0);

    // Read-only: the check must not delete anything.
    const stats = await get("/api/storage/stats");
    expect(stats.json().stats.fileCount).toBeGreaterThan(0);
  });

  it("reports missing objects in an integrity check", async () => {
    const file = (await upload("vanish.txt", "gone")).json().file;
    const record = h.repos._files.find((f) => f.id === file.id)!;
    h.provider.objects.delete(String(record.telegramMessageId));

    const report = (await post("/api/storage/integrity/check", {})).json().report;
    expect(report.missing).toBeGreaterThan(0);
  });
});

describe("pagination, sorting and filtering", () => {
  beforeAll(async () => {
    for (const name of ["p1.txt", "p2.txt", "p3.txt", "p4.txt", "p5.txt"]) {
      await upload(name, name);
    }
  });

  it("paginates listings", async () => {
    const page1 = await get("/api/files?sort=name&order=asc&limit=2&page=1&folderId=");
    const body1 = page1.json();
    expect(body1.files).toHaveLength(2);
    expect(body1.pagination).toMatchObject({ page: 1, limit: 2, hasMore: true });
    expect(body1.pagination.total).toBeGreaterThanOrEqual(5);

    const page2 = await get("/api/files?sort=name&order=asc&limit=2&page=2&folderId=");
    expect(page2.json().files[0].name).not.toBe(body1.files[0].name);
  });

  it("sorts by name descending", async () => {
    const names = (await get("/api/files?sort=name&order=desc&folderId="))
      .json()
      .files.map((f: { name: string }) => f.name);
    expect(names).toEqual([...names].sort().reverse());
  });

  it("filters by extension", async () => {
    const byExt = await get("/api/files?ext=txt&folderId=");
    expect(byExt.json().files.every((f: { name: string }) => f.name.endsWith(".txt"))).toBe(true);
  });
});

describe("multi-user isolation", () => {
  let privateFileId: string;

  beforeAll(async () => {
    privateFileId = (await upload("private.txt", "secret")).json().file.id;
  });

  it("hides another user's file metadata and download", async () => {
    expect((await get(`/api/files/${privateFileId}`, secondUserCookie)).statusCode).toBe(404);
    expect((await get(`/api/files/${privateFileId}/download`, secondUserCookie)).statusCode).toBe(
      404,
    );
  });

  it("does not leak data via search, trash or starred", async () => {
    expect((await get("/api/search?q=private", secondUserCookie)).json().files).toHaveLength(0);
    expect((await get("/api/trash", secondUserCookie)).json().files).toHaveLength(0);
    expect((await get("/api/starred", secondUserCookie)).json().files).toHaveLength(0);
  });

  it("cannot trash, delete or batch-mutate another user's file", async () => {
    expect((await post(`/api/files/${privateFileId}/trash`, {}, secondUserCookie)).statusCode).toBe(
      404,
    );
    expect((await del(`/api/files/${privateFileId}`, secondUserCookie)).statusCode).toBe(404);

    const batch = await post(
      "/api/files/batch",
      { operation: "delete", ids: [privateFileId] },
      secondUserCookie,
    );
    expect(batch.json()).toMatchObject({ succeeded: 0, failed: 1 });
  });

  it("keeps storage stats per user", async () => {
    const theirs = await get("/api/storage/stats", secondUserCookie);
    expect(theirs.json().stats.fileCount).toBe(0);
  });
});

describe("uploads & validation", () => {
  it("rejects uploads above the configured limit", async () => {
    const body = multipartBody({}, { name: "big.bin", data: Buffer.alloc(2 * 1024 * 1024) });
    const response = await h.app.inject({
      method: "POST",
      url: "/api/files",
      headers: { "content-type": body.contentType },
      payload: body.payload,
      cookies: cookies(),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("spools a large upload, stores its exact bytes, and leaves no temp files", async () => {
    const { readdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const spoolDirs = async () =>
      (await readdir(tmpdir())).filter((name) => name.startsWith("omnicloud-upload-"));
    const before = (await spoolDirs()).length;

    const payload = Buffer.alloc(900 * 1024, 11);
    const body = multipartBody({}, { name: "spooled.bin", data: payload });
    const response = await h.app.inject({
      method: "POST",
      url: "/api/files",
      headers: { "content-type": body.contentType },
      payload: body.payload,
      cookies: cookies(),
    });
    expect(response.statusCode).toBe(201);
    const id = response.json().file.id;

    const stored = await get(`/api/files/${id}/download`);
    expect(stored.rawPayload.equals(payload)).toBe(true);
    expect(response.json().file.sha256).toBe(createHash("sha256").update(payload).digest("hex"));
    expect((await spoolDirs()).length).toBe(before);
  });

  it("leaves no temp files after a rejected oversized upload", async () => {
    const { readdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const spoolDirs = async () =>
      (await readdir(tmpdir())).filter((name) => name.startsWith("omnicloud-upload-"));
    const before = (await spoolDirs()).length;

    const body = multipartBody({}, { name: "huge.bin", data: Buffer.alloc(2 * 1024 * 1024) });
    const response = await h.app.inject({
      method: "POST",
      url: "/api/files",
      headers: { "content-type": body.contentType },
      payload: body.payload,
      cookies: cookies(),
    });
    expect(response.statusCode).toBe(413);
    expect((await spoolDirs()).length).toBe(before);
  });

  it("rejects a non-multipart upload", async () => {
    const response = await h.app.inject({
      method: "POST",
      url: "/api/files",
      headers: { "content-type": "application/json" },
      payload: {},
      cookies: cookies(),
    });
    expect([400, 406, 415]).toContain(response.statusCode);
  });

  it("returns structured validation errors", async () => {
    const response = await post("/api/folders", {});
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_REQUEST");
  });

  it("ignores an invalid sort field", async () => {
    expect((await get("/api/files?sort=banana&folderId=")).statusCode).toBe(200);
  });

  it("returns a structured 404 for unknown API routes", async () => {
    const response = await get("/api/definitely-not-a-route");
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("NOT_FOUND");
  });
});
