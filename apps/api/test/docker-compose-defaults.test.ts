import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const compose = readFileSync(new URL("../../../docker-compose.yml", import.meta.url), "utf8");

describe("the development compose file", () => {
  it("binds PostgreSQL to loopback, not every interface", () => {
    const portLines = compose
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- ") && line.includes("5432"));
    expect(portLines).toHaveLength(1);
    const mapping = portLines[0]!.replace(/^-\s*/, "").replace(/^"|"$/g, "");
    // The part before the first colon is the host interface.
    expect(mapping.startsWith("127.0.0.1:")).toBe(true);
  });

  it("does not ship a hardcoded database password", () => {
    const password = /POSTGRES_PASSWORD:\s*(\S+)/.exec(compose)?.[1] ?? "";
    // An unset value is filled from the environment; a literal password is not.
    expect(password).toMatch(/^\$\{|^\$\{POSTGRES_PASSWORD/);
  });
});
