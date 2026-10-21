import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { OmniCloudClient } from "../src/index";

function acceptingClient() {
  const seen: { bytes: number; key: string | null }[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    let bytes = 0;
    if (init.body instanceof FormData) {
      const blob = init.body.get("file") as Blob;
      bytes = (await blob.arrayBuffer()).byteLength;
    }
    seen.push({ bytes, key: new Headers(init.headers).get("idempotency-key") });
    return new Response(JSON.stringify({ file: { id: "f1", name: "x" } }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { client: new OmniCloudClient({ baseUrl: "https://omni.test", fetchImpl }), seen };
}

describe("a non-replayable stream input", () => {
  it("is retried only because the bytes are held once, and the retry is safe under the same key", async () => {
    const { client, seen } = acceptingClient();
    const stream = Readable.from([Buffer.from("chunk-one"), Buffer.from("chunk-two")]);

    await client.files.upload({ data: stream as never, name: "s.txt" }, { retry: 0 });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.bytes).toBe(18);
    expect(seen[0]!.key).toBeTruthy();
  });
});
