import { describe, expect, it } from "vitest";
import { OmniCloudClient } from "../src/index";

function clientServing(body: Uint8Array, declaredLength: number) {
  const bytes = body.slice().buffer as ArrayBuffer;
  const fetchImpl = (async () =>
    new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(declaredLength),
      },
    })) as unknown as typeof fetch;
  return new OmniCloudClient({ baseUrl: "https://omni.test", fetchImpl });
}

describe("download truncation", () => {
  it("returns the body when its length matches Content-Length", async () => {
    const payload = new TextEncoder().encode("complete payload");
    const client = clientServing(payload, payload.byteLength);

    const result = await client.files.download("f1");
    expect(result.size).toBe(payload.byteLength);
  });

  it("rejects a body that ends before Content-Length", async () => {
    const partial = new TextEncoder().encode("only part");
    const client = clientServing(partial, partial.byteLength + 100);

    await expect(client.files.download("f1")).rejects.toMatchObject({
      code: "DOWNLOAD_INCOMPLETE",
    });
  });
});
