import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as sourceModule from "../src/index";

const dts = fileURLToPath(new URL("../dist/index.d.ts", import.meta.url));

/** dist/ is gitignored, so a local checkout may not have it. CI must. */
const hasDist = existsSync(dts);
const inCi = Boolean(process.env.CI);

/** The body of one declared class, so a check is scoped to that class. */
function readClassBody(source: string, className: string): string {
  const start = source.indexOf(`declare class ${className} `);
  if (start === -1) return "";
  const end = source.indexOf("\n}", start);
  return end === -1 ? source.slice(start) : source.slice(start, end);
}

/** The names the built declarations export, read from its export block. */
function readDeclaredNames(source: string): Set<string> {
  const block = /export \{([^}]*)\};?\s*$/.exec(source);
  if (block === null) return new Set();
  return new Set(
    block[1]!
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "")
      // Drop the "type " prefix and any renaming: "ERROR_CODES$1 as ERROR_CODES".
      .map((entry) => entry.replace(/^type\s+/, ""))
      .map((entry) => entry.split(/\s+as\s+/).pop()!)
      .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name)),
  );
}

// Locally the declarations may not be built yet, so the check is skipped. In CI it
// is mandatory: a skipped gate is not a passing gate.
describe.skipIf(!hasDist && !inCi)("published type declarations", () => {
  const source = hasDist ? readFileSync(dts, "utf8") : "";
  const declaredNames = readDeclaredNames(source);

  it("has built declarations to verify", () => {
    expect(hasDist).toBe(true);
  });

  it("imports nothing relative, because the package ships no other .d.ts files", () => {
    expect(source.match(/from '\.\.?\/[^']*'/g) ?? []).toEqual([]);
  });

  it("does not reference private workspace packages", () => {
    expect(source).not.toMatch(/from '@omnicloud\//);
  });

  it("declares every value the source exports", () => {
    // A stale build would leave a function that exists in src missing from
    // the published declarations, so npm consumers would not see it.
    const exported = Object.keys(sourceModule).sort();
    expect(exported.length).toBeGreaterThan(0);
    const missing = exported.filter((name) => !declaredNames.has(name));
    expect(missing).toEqual([]);
  });

  it("declares every method the client's sub-APIs expose", () => {
    // The sub-API methods are where a stale build hides: a method added to
    // src but not to the bundle is invisible to npm consumers, and the
    // top-level export check above would not see it.
    const client = new sourceModule.OmniCloudClient({ baseUrl: "https://example.test" });
    // The class each sub-API is declared as in the built declarations.
    const subApis = {
      files: "FilesApi",
      folders: "FoldersApi",
      trash: "TrashApi",
      storage: "StorageApi",
      auth: "AuthApi",
    } as const;
    const missing: string[] = [];
    for (const [name, className] of Object.entries(subApis)) {
      const body = readClassBody(source, className);
      expect(body, `${className} is not declared`).not.toBe("");
      const api = client[name as keyof typeof subApis] as unknown as object;
      for (const method of Object.getOwnPropertyNames(Object.getPrototypeOf(api))) {
        if (method === "constructor") continue;
        // A public method is declared as "name(", a private one as
        // "private name". Either counts as present. Scoped to this class, so a
        // method of the same name elsewhere cannot stand in for it.
        const declared = body.includes(`${method}(`) || body.includes(`private ${method}`);
        if (!declared) missing.push(`${name}.${method}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
