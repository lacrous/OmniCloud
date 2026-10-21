import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "./harness";
import { startUpdateChecker } from "../src/update-checker";

let h: TestHarness;

beforeAll(async () => {
  h = await createTestHarness();
});
afterAll(async () => {
  await h.app.close();
});

describe("update check endpoint", () => {
  it("answers without a session and reports the running version", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/update/check" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // With no checker wired (the default in tests) the endpoint says it does
    // not know yet rather than claiming the install is up to date.
    expect(body.status).toBe("unknown");
    expect(body.latestVersion).toBeNull();
  });

  it("serves the cached result of the last check", async () => {
    const checker = startUpdateChecker({
      currentVersion: "0.3.0",
      packageName: "@hilbras/omnicloud",
      registryUrl: "https://registry.test",
      fetchImpl: async () =>
        new Response(JSON.stringify({ version: "0.4.0" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    await checker.check();

    // Rebuild the app with the checker attached.
    const withChecker = await createTestHarness(
      undefined,
      undefined,
      null,
      undefined,
      undefined,
      checker,
    );
    try {
      const res = await withChecker.app.inject({ method: "GET", url: "/api/update/check" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("update_available");
      expect(body.latestVersion).toBe("0.4.0");
      expect(body.currentVersion).toBe("0.3.0");
      expect(body.packageName).toBe("@hilbras/omnicloud");
    } finally {
      await withChecker.app.close();
      checker.stop();
    }
  });
});
