import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/utils/hash";

describe("sha256Hex", () => {
  it("computes the known digest of an empty payload", () => {
    expect(sha256Hex(Buffer.alloc(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("computes the known digest of 'hello'", () => {
    expect(sha256Hex(Buffer.from("hello"))).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
});
