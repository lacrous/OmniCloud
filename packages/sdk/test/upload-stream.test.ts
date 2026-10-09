import { mkdtempSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OmniCloudClient } from "../src/index";

/** Captures the multipart body the client sends, and returns a valid file DTO. */
function recordingClient() {
  const captured: { body: Uint8Array | null; streamed: boolean } = { body: null, streamed: false };
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const body = init.body;
    captured.streamed = body instanceof ReadableStream;
    if (body instanceof ReadableStream) {
      const reader = body.getReader();
      const parts: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
      }
      captured.body = Buffer.concat(parts.map((p) => Buffer.from(p)));
    } else if (body instanceof FormData) {
      const blob = body.get("file") as Blob;
      captured.body = new Uint8Array(await blob.arrayBuffer());
    }
    return new Response(JSON.stringify({ file: { id: "f1", name: "x" } }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { client: new OmniCloudClient({ baseUrl: "https://omni.test", fetchImpl }), captured };
}

describe("upload input sources", () => {
  it("accepts a Node Readable and delivers its bytes intact", async () => {
    const { client, captured } = recordingClient();
    const source = Readable.from([Buffer.from("stream-"), Buffer.from("upload")]);
    await client.files.upload({ data: source as never, name: "s.txt" });
    expect(Buffer.from(captured.body!).toString()).toContain("stream-upload");
  });

  it("accepts a file path and reads it without the caller building a buffer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omni-up-"));
    const path = join(dir, "from-path.bin");
    writeFileSync(path, "path-bytes");
    const { client, captured } = recordingClient();
    await client.files.upload({ path, name: "from-path.bin" } as never);
    expect(Buffer.from(captured.body!).toString()).toContain("path-bytes");
  });

  it("still accepts a Uint8Array exactly as before", async () => {
    const { client, captured } = recordingClient();
    await client.files.upload({ data: new TextEncoder().encode("plain"), name: "p.txt" });
    expect(Buffer.from(captured.body!).toString()).toContain("plain");
  });
});
