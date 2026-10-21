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

async function uploadAndTrash(name: string): Promise<string> {
  const body = multipartBody({}, { name, data: Buffer.from("content") });
  const created = await h.app.inject({
    method: "POST",
    url: "/api/files",
    headers: { "content-type": body.contentType },
    payload: body.payload,
    cookies: { omnicloud_session: cookie },
  });
  expect(created.statusCode).toBeLessThan(300);
  const id = created.json().file.id as string;
  const trashed = await h.app.inject({
    method: "POST",
    url: `/api/files/${id}/trash`,
    cookies: { omnicloud_session: cookie },
  });
  expect(trashed.statusCode).toBeLessThan(300);
  return id;
}

describe("trash retention endpoints", () => {
  it("exposes the configured retention period", async () => {
    const response = await h.app.inject({
      method: "GET",
      url: "/api/trash/retention",
      cookies: { omnicloud_session: cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ days: 30 });
  });

  it("requires a signed-in user for the retention period", async () => {
    const response = await h.app.inject({ method: "GET", url: "/api/trash/retention" });
    expect(response.statusCode).toBe(401);
  });

  it("purges expired trash and keeps recent items", async () => {
    const expired = await uploadAndTrash("expired.txt");
    const recent = await uploadAndTrash("recent.txt");

    // Backdate the first file so it is past the 30 day retention.
    const past = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await h.container.repos.files.update(expired, { deletedAt: past });

    const response = await h.app.inject({
      method: "POST",
      url: "/api/trash/purge",
      cookies: { omnicloud_session: cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.deletedFiles).toBe(1);
    expect(body.skippedFiles).toBe(1);

    // The expired file is gone; the recent one is still in the trash.
    const gone = await h.app.inject({
      method: "GET",
      url: `/api/files/${expired}`,
      cookies: { omnicloud_session: cookie },
    });
    expect(gone.statusCode).toBe(404);
    const kept = await h.app.inject({
      method: "GET",
      url: `/api/files/${recent}`,
      cookies: { omnicloud_session: cookie },
    });
    expect(kept.statusCode).toBe(200);
    expect(kept.json().file.trashed).toBe(true);
  });

  it("requires a signed-in user to purge", async () => {
    const response = await h.app.inject({ method: "POST", url: "/api/trash/purge" });
    expect(response.statusCode).toBe(401);
  });
});
