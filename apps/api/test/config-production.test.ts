import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

const base = {
  TELEGRAM_API_ID: "12345",
  TELEGRAM_API_HASH: "hash-value",
  DATABASE_URL: "postgresql://u:p@localhost:5432/x",
};

describe("production configuration", () => {
  it("refuses to start in production without an encryption key", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production" } as never)).toThrow(
      /OMNICLOUD_ENCRYPTION_KEY must be set/,
    );
  });

  it("starts in production when the encryption key is set, without a session secret", () => {
    const config = loadConfig({
      ...base,
      NODE_ENV: "production",
      OMNICLOUD_ENCRYPTION_KEY: "a".repeat(64),
    } as never);
    expect(config.encryptionKey).toBe("a".repeat(64));
  });

  it("development runs without an encryption key, and reports it as not configured", () => {
    const config = loadConfig({ ...base, NODE_ENV: "development" } as never);
    expect(config.encryptionKey).toBeNull();
  });

  it("an empty encryption key counts as missing", () => {
    expect(() =>
      loadConfig({ ...base, NODE_ENV: "production", OMNICLOUD_ENCRYPTION_KEY: "" } as never),
    ).toThrow(/OMNICLOUD_ENCRYPTION_KEY/);
  });
});
