import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OmniCloudClient } from "../src/index";

function recordingClient() {
  const captured: { body: Uint8Array | null } = { body: null };
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const body = init.body as FormData;
    const blob = body.get("file") as Blob;
    captured.body = new Uint8Array(await blob.arrayBuffer());
    return new Response(JSON.stringify({ file: { id: "f1", name: "x" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { client: new OmniCloudClient({ baseUrl: "https://omni.test", fetchImpl }), captured };
}

describe("replace() sends the bytes it was given", () => {
  it("replaces a file from a path with that file's content, not an empty body", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omni-replace-"));
    const path = join(dir, "new.txt");
    writeFileSync(path, "fresh content from disk");
    const { client, captured } = recordingClient();

    await client.files.replace("f1", { path, name: "new.txt" });

    expect(captured.body).not.toBeNull();
    expect(Buffer.from(captured.body!).toString()).toBe("fresh content from disk");
  });
});

describe("replace() accepts the same inputs as upload()", () => {
  it("replaces from a byte array", async () => {
    const { client, captured } = recordingClient();
    await client.files.replace("f1", { data: new Uint8Array([104, 105]), name: "b.txt" });
    expect(Buffer.from(captured.body!).toString()).toBe("hi");
  });

  it("replaces from a readable stream", async () => {
    const { Readable } = await import("node:stream");
    const { client, captured } = recordingClient();
    const stream = Readable.from([Buffer.from("strea"), Buffer.from("m")]);
    await client.files.replace("f1", { data: stream as never, name: "s.txt" });
    expect(Buffer.from(captured.body!).toString()).toBe("stream");
  });
});
