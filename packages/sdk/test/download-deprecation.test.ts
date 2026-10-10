import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { OmniCloudClient } from "../src/index";

describe("files.download is deprecated for large files", () => {
  it("marks the buffered download method as deprecated in its source", () => {
    const source = readFileSync(new URL("../src/client.ts", import.meta.url), "utf8");
    const index = source.indexOf("async download(id: string");
    expect(index).toBeGreaterThan(-1);
    expect(source.slice(Math.max(0, index - 300), index)).toContain("@deprecated");
  });

  it("still returns the whole body, so existing callers keep working", async () => {
    const payload = new TextEncoder().encode("still whole");
    const fetchImpl = (async () =>
      new Response(payload.slice().buffer as ArrayBuffer, {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(payload.byteLength),
        },
      })) as unknown as typeof fetch;
    const client = new OmniCloudClient({ baseUrl: "https://omni.test", fetchImpl });
    const result = await client.files.download("f1");
    expect(result.size).toBe(payload.byteLength);
  });
});
