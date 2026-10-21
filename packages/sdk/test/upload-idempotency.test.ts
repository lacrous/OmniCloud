import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OmniCloudClient } from "../src/index";

/** Fails the first attempt, then accepts the retry, recording every request. */
function flakyClient() {
  const seen: { idempotencyKey: string | null; body: string }[] = [];
  let calls = 0;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    calls += 1;
    const headers = new Headers(init.headers);
    let body = "";
    if (init.body instanceof ReadableStream) {
      const decoder = new TextDecoder();
      const reader = init.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        body += decoder.decode(value, { stream: true });
      }
    } else if (init.body instanceof FormData) {
      body = await (init.body.get("file") as Blob).text();
    }
    seen.push({ idempotencyKey: headers.get("idempotency-key"), body });
    if (calls === 1) {
      return new Response(JSON.stringify({ error: { code: "UNAVAILABLE", message: "retry" } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
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
    seen,
  };
}

describe("SDK uploads carry an idempotency key", () => {
  it("sends the same key on every attempt of one logical upload", async () => {
    const { client, seen } = flakyClient();
    const dir = mkdtempSync(join(tmpdir(), "omni-sdk-"));
    const path = join(dir, "k.txt");
    writeFileSync(path, "key-body");

    await client.files.upload({ path, name: "k.txt" }, { retry: 1 });

    expect(seen).toHaveLength(2);
    expect(seen[0]!.idempotencyKey).toBeTruthy();
    expect(seen[1]!.idempotencyKey).toBe(seen[0]!.idempotencyKey);
  });

  it("uses the caller's key when one is given", async () => {
    const { client, seen } = flakyClient();
    const dir = mkdtempSync(join(tmpdir(), "omni-sdk-"));
    const path = join(dir, "k2.txt");
    writeFileSync(path, "key-body");

    await client.files.upload({ path, name: "k2.txt" }, { retry: 1, operationId: "my_key_000001" });

    expect(seen.every((s) => s.idempotencyKey === "my_key_000001")).toBe(true);
  });
});

describe("SDK replacement carries an idempotency key", () => {
  it("sends the caller's key on the replace request", async () => {
    const seen: (string | null)[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers).get("idempotency-key"));
      return new Response(JSON.stringify({ file: { id: "f1", name: "x" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const client = new OmniCloudClient({ baseUrl: "https://omni.test", fetchImpl });

    await client.files.replace(
      "f1",
      { data: Buffer.from("v"), name: "x.txt" },
      { operationId: "replace_key_1" },
    );

    expect(seen).toEqual(["replace_key_1"]);
  });
});
