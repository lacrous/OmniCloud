import { describe, expect, it } from "vitest";
import { OmniCloudClient } from "../src/index";

function recordingClient() {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(String(url));
    return new Response(
      JSON.stringify({ files: [], pagination: { page: 1, limit: 50, total: 0, pages: 0 } }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as unknown as typeof fetch;
  return { client: new OmniCloudClient({ baseUrl: "https://omni.test", fetchImpl }), urls };
}

describe("files.list and the folderId filter", () => {
  it("sends folderId= for the root, so the server returns root files only", async () => {
    const { client, urls } = recordingClient();
    await client.files.list({ folderId: null });
    expect(urls[0]).toContain("folderId=");
  });

  it("omits folderId entirely when the caller did not ask for it", async () => {
    const { client, urls } = recordingClient();
    await client.files.list({});
    expect(urls[0]).not.toContain("folderId");
  });

  it("sends the folder id when one is given", async () => {
    const { client, urls } = recordingClient();
    await client.files.list({ folderId: "f1" });
    expect(urls[0]).toContain("folderId=f1");
  });
});
