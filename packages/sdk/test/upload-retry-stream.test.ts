import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { OmniCloudClient } from "../src/index";

/** Fails the first request with a 503, then accepts whatever bytes the retry sends. */
function flakyClient() {
  const sent: string[] = [];
  let calls = 0;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    calls += 1;
    const blob = (init.body as FormData).get("file") as Blob;
    sent.push(Buffer.from(await blob.arrayBuffer()).toString());
    if (calls === 1) {
      return new Response(
        JSON.stringify({ error: { code: "UNAVAILABLE", message: "try again" } }),
        {
          status: 503,
          headers: { "content-type": "application/json" },
        },
      );
    }
    return new Response(JSON.stringify({ file: { id: "f1", name: "x" } }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return {
    client: new OmniCloudClient({
      baseUrl: "https://omni.test",
      fetchImpl,
      retry: { attempts: 1, baseDelayMs: 0 },
    }),
    sent,
  };
}

describe("a retried upload must send the same bytes as the first attempt", () => {
  it("retries a one-shot stream and the retry carries the full payload", async () => {
    const { client, sent } = flakyClient();
    const stream = Readable.from([Buffer.from("payload")]);

    const file = await client.files.upload({ data: stream as never, name: "p.txt" }, { retry: 1 });

    expect(file.id).toBe("f1");
    expect(sent).toHaveLength(2);
    expect(sent[0]).toBe("payload");
    expect(sent[1]).toBe("payload");
  });
});
