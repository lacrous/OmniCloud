import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const dir = () => mkdtempSync(join(tmpdir(), "omni-sdk-"));

describe("files.downloadToFile", () => {
  it("writes the exact bytes to the target path", async () => {
    const payload = new TextEncoder().encode("to disk");
    const target = join(dir(), "out.bin");
    const client = clientServing(payload, payload.byteLength);

    const result = await client.files.downloadToFile("f1", target);

    expect(readFileSync(target).toString()).toBe("to disk");
    expect(result.bytes).toBe(payload.byteLength);
  });

  it("never puts a truncated body at the target path, even while it is being written", async () => {
    const partial = new TextEncoder().encode("cut short");
    const target = join(dir(), "partial.bin");
    const bytes = partial.slice().buffer as ArrayBuffer;
    let seenAtTargetBeforeFailure = false;
    const fetchImpl = (async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(bytes));
          // Before the stream ends short, check that nothing is at the target yet.
          setTimeout(() => {
            seenAtTargetBeforeFailure = existsSync(target);
            controller.close();
          }, 20);
        },
      });
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(partial.byteLength + 500),
        },
      });
    }) as unknown as typeof fetch;
    const client = new OmniCloudClient({ baseUrl: "https://omni.test", fetchImpl });

    await expect(client.files.downloadToFile("f1", target)).rejects.toMatchObject({
      code: "DOWNLOAD_INCOMPLETE",
    });
    expect(seenAtTargetBeforeFailure).toBe(false);
    expect(existsSync(target)).toBe(false);
  });

  it("never leaves a file at the target before the download completes", async () => {
    const payload = new TextEncoder().encode("atomic");
    const target = join(dir(), "atomic.bin");
    const client = clientServing(payload, payload.byteLength);
    await client.files.downloadToFile("f1", target);
    expect(readFileSync(target).toString()).toBe("atomic");
    expect(existsSync(`${target}.part`)).toBe(false);
  });
});
