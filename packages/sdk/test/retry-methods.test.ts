import { describe, expect, it } from "vitest";
import { OmniCloudClient } from "../src/index";

/** Returns 503 on the first call and 200 afterwards, counting calls per method. */
function failOnceClient() {
  const calls: string[] = [];
  let failed = false;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    calls.push(String(init.method));
    if (!failed) {
      failed = true;
      return new Response(
        JSON.stringify({ error: { code: "UNAVAILABLE", message: "try again" } }),
        {
          status: 503,
          headers: { "content-type": "application/json" },
        },
      );
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return {
    calls,
    client: new OmniCloudClient({
      baseUrl: "https://omni.test",
      fetchImpl,
      retry: { attempts: 3, baseDelayMs: 0 },
    }),
  };
}

describe("automatic retries only repeat methods that are safe to repeat", () => {
  it("retries a GET after a 503", async () => {
    const { client, calls } = failOnceClient();
    await client.request("GET", "/api/files");
    expect(calls).toEqual(["GET", "GET"]);
  });

  it("does not repeat a POST after a 503, because the server may already have changed state", async () => {
    const { client, calls } = failOnceClient();
    await expect(client.request("POST", "/api/folders", { name: "x" })).rejects.toThrow();
    expect(calls).toEqual(["POST"]);
  });

  it("does not repeat a PATCH after a 503", async () => {
    const { client, calls } = failOnceClient();
    await expect(client.request("PATCH", "/api/files/1", { name: "x" })).rejects.toThrow();
    expect(calls).toEqual(["PATCH"]);
  });
});
