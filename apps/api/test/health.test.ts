import { describe, expect, it } from "vitest";
import { encryptionCheck, readiness, type ComponentCheck } from "../src/health";

const healthy = (name: ComponentCheck["name"]): ComponentCheck => ({
  name,
  state: "healthy",
  detail: null,
});

describe("readiness", () => {
  it("is ready when the database and encryption are healthy", () => {
    expect(readiness([healthy("database"), healthy("encryption")]).ready).toBe(true);
  });

  it("is not ready when the database is unhealthy", () => {
    const report = readiness([
      { name: "database", state: "unhealthy", detail: "connection refused" },
      healthy("encryption"),
    ]);
    expect(report.ready).toBe(false);
  });

  it("is not ready when encryption is not configured", () => {
    expect(readiness([healthy("database"), encryptionCheck(false)]).ready).toBe(false);
  });

  it("does not require storage: a user may not have connected Telegram yet", () => {
    const report = readiness([
      healthy("database"),
      healthy("encryption"),
      { name: "storage", state: "unhealthy", detail: "not connected" },
    ]);
    expect(report.ready).toBe(true);
  });

  it("never reports ready on an unknown required component", () => {
    expect(
      readiness([{ name: "database", state: "unknown", detail: null }, healthy("encryption")])
        .ready,
    ).toBe(false);
  });
});

describe("encryption check", () => {
  it("reports a missing key without revealing any value", () => {
    const check = encryptionCheck(false);
    expect(check.state).toBe("not_configured");
    expect(check.detail).toContain("OMNICLOUD_ENCRYPTION_KEY");
    expect(check.detail).not.toMatch(/[0-9a-f]{32,}/i);
  });
});
