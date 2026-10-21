import { describe, expect, it } from "vitest";
import { compareVersions, startUpdateChecker } from "../src/update-checker";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("compareVersions", () => {
  it("orders by major, minor, then patch", () => {
    expect(compareVersions("1.0.1", "1.0.0")).toBeGreaterThan(0);
    expect(compareVersions("1.1.0", "1.0.9")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
  });

  it("treats equal versions as equal", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
  });

  it("sorts a prerelease before its release", () => {
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-beta.1")).toBeGreaterThan(0);
  });

  it("handles missing minor and patch components", () => {
    expect(compareVersions("1.1", "1.0.9")).toBeGreaterThan(0);
    expect(compareVersions("1", "1.0.0")).toBe(0);
  });

  it("ignores build metadata when ordering", () => {
    expect(compareVersions("1.0.0+build.7", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.1+build.7", "1.0.0")).toBeGreaterThan(0);
  });
});

describe("update checker", () => {
  it("reports an available update when npm has a newer version", async () => {
    const checker = startUpdateChecker({
      currentVersion: "0.3.0",
      packageName: "@hilbras/omnicloud",
      registryUrl: "https://registry.test",
      fetchImpl: async () => jsonResponse({ version: "0.4.0" }),
    });
    try {
      const result = await checker.check();
      expect(result.status).toBe("update_available");
      expect(result.latestVersion).toBe("0.4.0");
      expect(result.currentVersion).toBe("0.3.0");
    } finally {
      checker.stop();
    }
  });

  it("reports up to date when the published version matches", async () => {
    const checker = startUpdateChecker({
      currentVersion: "0.3.0",
      packageName: "@hilbras/omnicloud",
      registryUrl: "https://registry.test",
      fetchImpl: async () => jsonResponse({ version: "0.3.0" }),
    });
    try {
      expect((await checker.check()).status).toBe("up_to_date");
    } finally {
      checker.stop();
    }
  });

  it("does not report an update when the local version is newer", async () => {
    const checker = startUpdateChecker({
      currentVersion: "0.5.0",
      packageName: "@hilbras/omnicloud",
      registryUrl: "https://registry.test",
      fetchImpl: async () => jsonResponse({ version: "0.4.0" }),
    });
    try {
      expect((await checker.check()).status).toBe("up_to_date");
    } finally {
      checker.stop();
    }
  });

  it("reports not_published when the registry has no such package", async () => {
    const checker = startUpdateChecker({
      currentVersion: "0.3.0",
      packageName: "@hilbras/omnicloud",
      registryUrl: "https://registry.test",
      fetchImpl: async () => jsonResponse({ error: "Not found" }, 404),
    });
    try {
      const result = await checker.check();
      expect(result.status).toBe("not_published");
      expect(result.latestVersion).toBeNull();
    } finally {
      checker.stop();
    }
  });

  it("reports unknown when the registry cannot be reached", async () => {
    const checker = startUpdateChecker({
      currentVersion: "0.3.0",
      packageName: "@hilbras/omnicloud",
      registryUrl: "https://registry.test",
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });
    try {
      const result = await checker.check();
      expect(result.status).toBe("unknown");
      expect(result.detail).toContain("network down");
    } finally {
      checker.stop();
    }
  });

  it("percent-encodes the scope in the registry path", async () => {
    let requested = "";
    const checker = startUpdateChecker({
      currentVersion: "0.3.0",
      packageName: "@hilbras/omnicloud",
      registryUrl: "https://registry.test",
      fetchImpl: async (input) => {
        requested = String(input);
        return jsonResponse({ version: "0.3.0" });
      },
    });
    try {
      await checker.check();
      expect(requested).toBe("https://registry.test/@hilbras%2fomnicloud/latest");
    } finally {
      checker.stop();
    }
  });

  it("caches the last result for the endpoint to serve", async () => {
    const checker = startUpdateChecker({
      currentVersion: "0.3.0",
      packageName: "@hilbras/omnicloud",
      registryUrl: "https://registry.test",
      fetchImpl: async () => jsonResponse({ version: "0.4.0" }),
    });
    try {
      expect(checker.current()).toBeNull();
      await checker.check();
      expect(checker.current()?.status).toBe("update_available");
    } finally {
      checker.stop();
    }
  });
});
