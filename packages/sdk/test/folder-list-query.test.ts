import { describe, expect, it } from "vitest";
import { OmniCloudClient } from "../src/index";

function capturingClient() {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(url);
    return new Response(
      JSON.stringify({ folders: [], pagination: { page: 1, limit: 50, total: 0, hasMore: false } }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as unknown as typeof fetch;
  return { client: new OmniCloudClient({ baseUrl: "https://omni.test", fetchImpl }), urls };
}

describe("folders.list() keeps every query field", () => {
  it("passes page and limit through when filtering by parent", async () => {
    const { client, urls } = capturingClient();
    await client.folders.list({ parentId: "p1", page: 2, limit: 25 });
    const url = new URL(urls[0]!);
    expect(url.searchParams.get("parentId")).toBe("p1");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("limit")).toBe("25");
  });

  it("still lists the root when parentId is null", async () => {
    const { client, urls } = capturingClient();
    await client.folders.list({ parentId: null });
    expect(new URL(urls[0]!).searchParams.get("parentId")).toBe("");
  });
});
