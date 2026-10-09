import { describe, expect, it } from "vitest";
import { parseArgs, parseEnvFile } from "../src/cli";

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
