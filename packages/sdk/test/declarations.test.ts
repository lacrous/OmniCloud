import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dts = fileURLToPath(new URL("../dist/index.d.ts", import.meta.url));

describe.skipIf(!existsSync(dts))("published type declarations", () => {
  const source = existsSync(dts) ? readFileSync(dts, "utf8") : "";

  it("imports nothing relative, because the package ships no other .d.ts files", () => {
    expect(source.match(/from '\.\.?\/[^']*'/g) ?? []).toEqual([]);
  });

  it("does not reference private workspace packages", () => {
    expect(source).not.toMatch(/from '@omnicloud\//);
  });
});
