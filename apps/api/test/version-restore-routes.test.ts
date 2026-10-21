import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, multipartBody, type TestHarness } from "./harness";

let h: TestHarness;
let cookie: string;

beforeAll(async () => {
  h = await createTestHarness();
  cookie = await h.login();
});

afterAll(async () => {
  await h?.container.shutdown();
});

async function uploadFile(name: string, text: string, replaceFileId?: string): Promise<string> {
  const body = multipartBody(replaceFileId ? {} : {}, { name, data: Buffer.from(text) });
  const response = await h.app.inject({
    method: "POST",
    url: replaceFileId ? `/api/files/${replaceFileId}/replace` : "/api/files",
    headers: { "content-type": body.contentType },
    payload: body.payload,
    cookies: { omnicloud_session: cookie },
  });
  expect(response.statusCode).toBeLessThan(300);
  return response.json().file.id as string;
}

/** A file with two versions; returns the id and the version ids, oldest first. */
async function fileWithTwoVersions(name: string) {
  const id = await uploadFile(name, "one");
  await uploadFile(name, "two", id);
  const response = await h.app.inject({
    method: "GET",
    url: `/api/files/${id}/versions`,
    cookies: { omnicloud_session: cookie },
  });
  expect(response.statusCode).toBe(200);
  // The endpoint lists newest first.
  const versions = response.json().versions as { id: string; versionNumber: number }[];
  expect(versions).toHaveLength(2);
  const oldest = versions[versions.length - 1]!;
  const newest = versions[0]!;
  return { id, oldest, newest };
}

describe("POST /api/files/:id/versions/:versionId/restore", () => {
  it("requires a signed-in user", async () => {
    const { id, oldest } = await fileWithTwoVersions("r1.txt");
    const response = await h.app.inject({
      method: "POST",
      url: `/api/files/${id}/versions/${oldest.id}/restore`,
    });
    expect(response.statusCode).toBe(401);
  });

  it("makes the older version current again", async () => {
    const { id, oldest } = await fileWithTwoVersions("r2.txt");
    const response = await h.app.inject({
      method: "POST",
      url: `/api/files/${id}/versions/${oldest.id}/restore`,
      cookies: { omnicloud_session: cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().file.currentVersionId).toBe(oldest.id);
  });

  it("leaves the other version in the history", async () => {
    const { id, oldest, newest } = await fileWithTwoVersions("r3.txt");
    await h.app.inject({
      method: "POST",
      url: `/api/files/${id}/versions/${oldest.id}/restore`,
      cookies: { omnicloud_session: cookie },
    });
    const response = await h.app.inject({
      method: "GET",
      url: `/api/files/${id}/versions`,
      cookies: { omnicloud_session: cookie },
    });
    const versions = response.json().versions as { id: string }[];
    expect(versions).toHaveLength(2);
    expect(versions.map((v) => v.id)).toContain(newest.id);
  });

  it("rejects restoring the version that is already current", async () => {
    const { id, newest } = await fileWithTwoVersions("r4.txt");
    const response = await h.app.inject({
      method: "POST",
      url: `/api/files/${id}/versions/${newest.id}/restore`,
      cookies: { omnicloud_session: cookie },
    });
    expect(response.statusCode).toBe(409);
  });

  it("returns 404 for a version that does not exist", async () => {
    const { id } = await fileWithTwoVersions("r5.txt");
    const response = await h.app.inject({
      method: "POST",
      url: `/api/files/${id}/versions/does-not-exist/restore`,
      cookies: { omnicloud_session: cookie },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("DELETE /api/files/:id/versions/:versionId", () => {
  it("requires a signed-in user", async () => {
    const { id, oldest } = await fileWithTwoVersions("d1.txt");
    const response = await h.app.inject({
      method: "DELETE",
      url: `/api/files/${id}/versions/${oldest.id}`,
    });
    expect(response.statusCode).toBe(401);
  });

  it("removes that version and leaves the others", async () => {
    const { id, oldest, newest } = await fileWithTwoVersions("d2.txt");
    const response = await h.app.inject({
      method: "DELETE",
      url: `/api/files/${id}/versions/${oldest.id}`,
      cookies: { omnicloud_session: cookie },
    });
    expect(response.statusCode).toBe(204);

    const after = await h.app.inject({
      method: "GET",
      url: `/api/files/${id}/versions`,
      cookies: { omnicloud_session: cookie },
    });
    const versions = after.json().versions as { id: string }[];
    expect(versions).toHaveLength(1);
    expect(versions[0]!.id).toBe(newest.id);
  });

  it("refuses to delete the current version", async () => {
    const { id, newest } = await fileWithTwoVersions("d3.txt");
    const response = await h.app.inject({
      method: "DELETE",
      url: `/api/files/${id}/versions/${newest.id}`,
      cookies: { omnicloud_session: cookie },
    });
    expect(response.statusCode).toBe(409);
  });

  it("returns 404 for a version that does not exist", async () => {
    const { id } = await fileWithTwoVersions("d4.txt");
    const response = await h.app.inject({
      method: "DELETE",
      url: `/api/files/${id}/versions/nope`,
      cookies: { omnicloud_session: cookie },
    });
    expect(response.statusCode).toBe(404);
  });

  it("does not touch another user's file", async () => {
    const { id, oldest } = await fileWithTwoVersions("d5.txt");
    const otherCookie = await h.login("+15550000999");
    const response = await h.app.inject({
      method: "DELETE",
      url: `/api/files/${id}/versions/${oldest.id}`,
      cookies: { omnicloud_session: otherCookie },
    });
    expect(response.statusCode).toBe(404);
  });
});
