import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestHarness } from "./harness";

describe("content security policy on served pages", () => {
  it("serves the web app with a policy that forbids unsafe-inline", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omni-web-"));
    writeFileSync(
      join(dir, "index.html"),
      "<!doctype html><html><body><script>1</script></body></html>",
    );
    const h = await createTestHarness(undefined, undefined, null, dir);
    const res = await h.app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    const policy = res.headers["content-security-policy"] as string;
    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toContain("unsafe-inline");
    await h.app.close();
  });

  it("does not add a policy to JSON API responses", async () => {
    const h = await createTestHarness();
    const res = await h.app.inject({ method: "GET", url: "/api/health/live" });
    expect(res.headers["content-security-policy"]).toBeUndefined();
    await h.app.close();
  });
});
