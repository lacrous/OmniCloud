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
        "x-content-sha256": "abc123",
      },
    })) as unknown as typeof fetch;
  return new OmniCloudClient({ baseUrl: "https://omni.test", fetchImpl });
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

describe("files.downloadStream", () => {
  it("delivers the exact bytes as a stream", async () => {
    const payload = new TextEncoder().encode("streamed body");
    const client = clientServing(payload, payload.byteLength);
    const { stream, size, sha256 } = await client.files.downloadStream("f1");
    expect(new TextDecoder().decode(await drain(stream))).toBe("streamed body");
    expect(size).toBe(payload.byteLength);
    expect(sha256).toBe("abc123");
  });

  it("errors the stream when the body ends before Content-Length", async () => {
    const partial = new TextEncoder().encode("short");
    const client = clientServing(partial, partial.byteLength + 50);
    const { stream } = await client.files.downloadStream("f1");
    await expect(drain(stream)).rejects.toMatchObject({ code: "DOWNLOAD_INCOMPLETE" });
  });

  it("reports progress as bytes arrive", async () => {
    const payload = new TextEncoder().encode("progress");
    const client = clientServing(payload, payload.byteLength);
    const seen: number[] = [];
    const { stream } = await client.files.downloadStream("f1", (p) => seen.push(p.loaded));
    await drain(stream);
    expect(seen[seen.length - 1]).toBe(payload.byteLength);
  });
});
