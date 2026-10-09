import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "./harness";

let h: TestHarness;

beforeAll(async () => {
  h = await createTestHarness();
});

afterAll(async () => {
  await h?.container.shutdown();
});

async function start() {
  const response = await h.app.inject({
    method: "POST",
    url: "/api/auth/telegram/qr/start",
    payload: {},
  });
  expect(response.statusCode).toBe(200);
  return response.json() as { flowId: string; token: { url: string; expiresAt: number } };
}

function status(flowId: string) {
  return h.app.inject({
    method: "GET",
    url: `/api/auth/telegram/qr/status?flowId=${encodeURIComponent(flowId)}`,
  });
}

describe("QR sign-in routes", () => {
  it("returns a flow id and a tg:// login link to show as a QR code", async () => {
    const started = await start();
    expect(started.flowId).toMatch(/\S+/);
    expect(started.token.url.startsWith("tg://login?token=")).toBe(true);
    expect(started.token.expiresAt).toBeGreaterThan(Date.now());
  });

  it("reports waiting, with a token, until the phone approves", async () => {
    const started = await start();
    const response = await status(started.flowId);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "waiting",
      token: { url: expect.stringMatching(/^tg:\/\/login\?token=/) },
    });
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("issues the browser session cookie once the phone approves", async () => {
    const started = await start();
    h.connectionDouble.approveQr(started.flowId);
    const response = await status(started.flowId);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", user: { firstName: "Test" } });
    expect(String(response.headers["set-cookie"] ?? "")).toContain("omnicloud_session=");
  });

  it("asks for the two-factor password when the account requires it", async () => {
    const started = await start();
    h.connectionDouble.approveQr(started.flowId, true);
    const response = await status(started.flowId);
    expect(response.json()).toEqual({ status: "password_required" });
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("rejects a status request for an unknown or finished flow", async () => {
    const response = await status("does-not-exist");
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.json().error.message).toContain("ended");
  });

  it("requires a flow id to poll", async () => {
    const response = await h.app.inject({ method: "GET", url: "/api/auth/telegram/qr/status" });
    expect(response.statusCode).toBe(400);
  });
});
