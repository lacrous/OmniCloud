import { describe, expect, it } from "vitest";
import { buildEnvFile, parseArgs, parseEnvFile, validateSetup } from "../src/cli";

describe("parseArgs", () => {
  it("starts the server and opens the browser when run with no arguments", () => {
    expect(parseArgs([])).toEqual({ command: "start", migrate: false, envFile: null, open: true });
  });

  it("treats a bare option as start", () => {
    expect(parseArgs(["--no-open"])).toEqual({
      command: "start",
      migrate: false,
      envFile: null,
      open: false,
    });
  });

  it("reads start with --no-open and --env", () => {
    expect(parseArgs(["start", "--no-open", "--env", "prod.env"])).toEqual({
      command: "start",
      migrate: false,
      envFile: "prod.env",
      open: false,
    });
  });

  it("keeps accepting --migrate for existing scripts", () => {
    expect(parseArgs(["start", "--migrate"])).toEqual({
      command: "start",
      migrate: true,
      envFile: null,
      open: true,
    });
  });

  it("accepts --env=<file>", () => {
    expect(parseArgs(["migrate", "--env=.env.local"])).toEqual({
      command: "migrate",
      migrate: false,
      envFile: ".env.local",
      open: true,
    });
  });

  it("rejects unknown options and a missing --env value", () => {
    expect(() => parseArgs(["start", "--port", "1"])).toThrow("Unknown option: --port");
    expect(() => parseArgs(["start", "--env"])).toThrow("--env requires a file path");
  });
});

describe("parseEnvFile", () => {
  it("reads simple, quoted and exported assignments and skips comments", () => {
    const values = parseEnvFile(
      [
        "# comment",
        "",
        "DATABASE_URL=postgresql://u:p@h:5432/db",
        'TELEGRAM_API_HASH="abc def"',
        "export PORT=4000",
        "SINGLE='x y'",
      ].join("\n"),
    );
    expect(values).toEqual({
      DATABASE_URL: "postgresql://u:p@h:5432/db",
      TELEGRAM_API_HASH: "abc def",
      PORT: "4000",
      SINGLE: "x y",
    });
  });

  it("strips trailing inline comments from unquoted values", () => {
    expect(parseEnvFile("HOST=0.0.0.0 # all interfaces")).toEqual({ HOST: "0.0.0.0" });
  });

  it("keeps a hash that is part of a value", () => {
    expect(parseEnvFile("KEY=abc#def")).toEqual({ KEY: "abc#def" });
  });
});

describe("buildEnvFile", () => {
  it("writes the four settings in the format the server reads", () => {
    const content = buildEnvFile({
      databaseUrl: "postgresql://u:p@127.0.0.1:5432/db",
      apiId: "12345",
      apiHash: "0123456789abcdef0123456789abcdef",
      encryptionKey: "a".repeat(64),
    });
    expect(parseEnvFile(content)).toEqual({
      DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db",
      TELEGRAM_API_ID: "12345",
      TELEGRAM_API_HASH: "0123456789abcdef0123456789abcdef",
      OMNICLOUD_ENCRYPTION_KEY: "a".repeat(64),
    });
  });
});

describe("validateSetup", () => {
  const valid = {
    databaseUrl: "postgresql://omnicloud:omnicloud@127.0.0.1:5432/omnicloud",
    apiId: "12345",
    apiHash: "0123456789abcdef0123456789abcdef",
  };

  it("accepts well-formed values", () => {
    expect(validateSetup(valid)).toBeNull();
  });

  it("rejects a database URL without credentials or database name", () => {
    expect(validateSetup({ ...valid, databaseUrl: "localhost:5432" })).toContain("DATABASE_URL");
  });

  it("rejects a non-numeric API ID", () => {
    expect(validateSetup({ ...valid, apiId: "abc" })).toContain("TELEGRAM_API_ID");
  });

  it("rejects an API hash that is not 32 hex characters", () => {
    expect(validateSetup({ ...valid, apiHash: "short" })).toContain("TELEGRAM_API_HASH");
  });
});
