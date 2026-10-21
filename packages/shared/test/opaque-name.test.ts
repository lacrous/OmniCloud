import { describe, expect, it } from "vitest";
import { generateOpaqueName, isOpaqueName } from "../src/opaque-name";

describe("opaque names", () => {
  it("is a prefix and 32 hex characters", () => {
    const name = generateOpaqueName();
    expect(name).toMatch(/^om_[0-9a-f]{32}$/);
    expect(isOpaqueName(name)).toBe(true);
  });

  it("is derived from the given random bytes, so a client can reproduce it", () => {
    const bytes = new Uint8Array(16).fill(0xab);
    expect(generateOpaqueName(bytes)).toBe(`om_${"ab".repeat(16)}`);
  });

  it("gives two uploads of the same content unrelated names", () => {
    expect(generateOpaqueName()).not.toBe(generateOpaqueName());
  });

  it("does not recognise a real name as an opaque one", () => {
    expect(isOpaqueName("report.pdf")).toBe(false);
    expect(isOpaqueName("om_tooshort")).toBe(false);
    expect(isOpaqueName("om_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz")).toBe(false);
    expect(isOpaqueName("")).toBe(false);
  });

  it("rejects bytes of the wrong length", () => {
    expect(() => generateOpaqueName(new Uint8Array(8))).toThrow(/16 random bytes/);
  });
});
