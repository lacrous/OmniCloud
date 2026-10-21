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

describe("trash retention configuration", () => {
  it("defaults to thirty days", () => {
    expect(loadConfig({ ...base } as never).trashRetentionDays).toBe(30);
  });

  it("accepts zero, which keeps the trash indefinitely", () => {
    // TrashService treats a retention of zero or less as "keep everything", so
    // the loader has to accept it. It used to reject it as "not a positive
    // integer", which made the documented setting impossible to use.
    expect(loadConfig({ ...base, TRASH_RETENTION_DAYS: "0" } as never).trashRetentionDays).toBe(0);
  });

  it("accepts a positive number of days", () => {
    expect(loadConfig({ ...base, TRASH_RETENTION_DAYS: "7" } as never).trashRetentionDays).toBe(7);
  });

  it("rejects a negative retention", () => {
    expect(() => loadConfig({ ...base, TRASH_RETENTION_DAYS: "-1" } as never)).toThrow(
      /TRASH_RETENTION_DAYS must be zero or a positive integer/,
    );
  });
});
