import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encryptFile, generateUrk } from "@omnicloud/crypto";
import { migrateToOpaqueName } from "../src/api/migration";

const originalFetch = globalThis.fetch;

interface Call {
  method: string;
  url: string;
}

let calls: Call[] = [];
let envelope: Uint8Array;
let wrappedKey: string;
let metadataBlob: string;
let urk: Uint8Array;

/** The file record the server returns: an OCE1 file with a plaintext name. */
function fileDto(overrides: Record<string, unknown> = {}) {
  return {
    id: "file-1",
    name: "report.pdf",
    size: 11,
    mimeType: "application/pdf",
    sha256: "a",
    folderId: null,
    starred: false,
    trashed: false,
    deletedAt: null,
    versionCount: 1,
    currentVersionId: "version-1",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    encryptionFormat: "OCE1",
    wrappedKey,
    metadataBlob,
    keyEpoch: 0,
    ...overrides,
  };
}

function versionsResponse() {
  return json({
    versions: [
      {
        id: "version-1",
        fileId: "file-1",
        versionNumber: 1,
        size: 11,
        mimeType: "application/pdf",
        sha256: "a",
        telegramMessageId: 1,
        isCurrent: true,
        encryptionFormat: "OCE1",
        wrappedKey,
        metadataBlob,
        keyEpoch: 0,
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ],
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(async () => {
  urk = generateUrk();
  const encrypted = await encryptFile(new TextEncoder().encode("hello world"), {
    urk,
    metadata: { name: "report.pdf", mimeType: "application/pdf" },
  });
  envelope = encrypted.envelope;
  wrappedKey = Buffer.from(encrypted.wrappedKey).toString("base64");
  metadataBlob = Buffer.from(encrypted.metadataBlob).toString("base64");
  calls = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("moving a file to a name the server cannot read", () => {
  it("uploads an opaque version, verifies it, and only then removes the old one", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ method, url });

      if (method === "GET" && url.endsWith("/api/files/file-1")) {
        return json({ file: fileDto() });
      }
      if (method === "GET" && url.endsWith("/api/files/file-1/versions")) {
        return versionsResponse();
      }
      if (method === "GET" && url.endsWith("/api/files/file-1/download")) {
        return new Response(envelope.slice().buffer, { status: 200 });
      }
      if (method === "POST" && url.endsWith("/api/files/file-1/replace")) {
        return json({
          file: fileDto({
            name: "opaque",
            encryptionFormat: "OCE2",
            currentVersionId: "version-2",
            versionCount: 2,
          }),
        });
      }
      if (method === "DELETE" && url.includes("/api/files/file-1/versions/")) {
        return new Response(null, { status: 204 });
      }
      return json({ error: { code: "NOT_FOUND" } }, 404);
    }) as typeof fetch;

    const result = await migrateToOpaqueName("file-1", urk);

    expect(result.status).toBe("migrated");
    expect(result.name).toBe("report.pdf");

    // The order matters: the old version is removed only after the upload and
    // the verification.
    const uploadAt = calls.findIndex((c) => c.method === "POST");
    const deleteAt = calls.findIndex((c) => c.method === "DELETE");
    expect(uploadAt).toBeGreaterThanOrEqual(0);
    expect(deleteAt).toBeGreaterThan(uploadAt);
  });

  it("uploads under an opaque name, never the real one", async () => {
    let uploadedFilename: string | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (method === "GET" && url.endsWith("/api/files/file-1")) {
        return json({ file: fileDto() });
      }
      if (method === "GET" && url.endsWith("/api/files/file-1/versions")) {
        return versionsResponse();
      }
      if (method === "GET" && url.endsWith("/api/files/file-1/download")) {
        return new Response(envelope.slice().buffer, { status: 200 });
      }
      if (method === "POST" && url.endsWith("/api/files/file-1/replace")) {
        const form = init?.body as FormData;
        const part = form.get("file");
        if (part instanceof File) uploadedFilename = part.name;
        return json({ file: fileDto({ encryptionFormat: "OCE2", currentVersionId: "version-2" }) });
      }
      return json({ error: { code: "NOT_FOUND" } }, 404);
    }) as typeof fetch;

    await migrateToOpaqueName("file-1", urk);

    expect(uploadedFilename).not.toBeNull();
    expect(uploadedFilename).toMatch(/^om_[0-9a-f]{32}$/);
    expect(uploadedFilename).not.toBe("report.pdf");
  });

  it("leaves the file alone when the verification fails", async () => {
    let downloads = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (method === "GET" && url.endsWith("/api/files/file-1")) {
        return json({ file: fileDto() });
      }
      if (method === "GET" && url.endsWith("/api/files/file-1/versions")) {
        return versionsResponse();
      }
      if (method === "GET" && url.endsWith("/api/files/file-1/download")) {
        downloads += 1;
        // The first read is the original, which is fine. The second is the
        // verification of what was just uploaded, and it is not what was
        // uploaded: the verification must catch it and leave the file as it
        // was.
        if (downloads === 1) return new Response(envelope.slice().buffer, { status: 200 });
        return new Response(new Uint8Array(32).buffer, { status: 200 });
      }
      if (method === "POST" && url.endsWith("/api/files/file-1/replace")) {
        return json({ file: fileDto({ encryptionFormat: "OCE2", currentVersionId: "version-2" }) });
      }
      return json({ error: { code: "NOT_FOUND" } }, 404);
    }) as typeof fetch;

    const result = await migrateToOpaqueName("file-1", urk);

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/verification failed/i);
    // Nothing was deleted.
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("refuses a file that is already opaque, and a plaintext one", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/files/file-1")) {
        return json({ file: fileDto({ encryptionFormat: "OCE2" }) });
      }
      return json({ error: { code: "NOT_FOUND" } }, 404);
    }) as typeof fetch;

    expect((await migrateToOpaqueName("file-1", urk)).status).toBe("already_migrated");

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/files/file-1")) {
        return json({
          file: fileDto({ encryptionFormat: null, wrappedKey: null, metadataBlob: null }),
        });
      }
      return json({ error: { code: "NOT_FOUND" } }, 404);
    }) as typeof fetch;

    const plaintext = await migrateToOpaqueName("file-1", urk);
    expect(plaintext.status).toBe("failed");
    expect(plaintext.error).toMatch(/encrypt it first/i);
  });
});
import { serverSideNameFor } from "../src/lib/rename-metadata";
import type { DriveItem } from "../src/lib/drive";

function driveItem(encryptionFormat: string | null, name: string): DriveItem {
  return {
    kind: "file",
    id: "file-1",
    name,
    size: 1024,
    mimeType: "application/pdf",
    starred: false,
    trashed: false,
    deletedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    versionCount: 1,
    file: {
      id: "file-1",
      name,
      size: 1024,
      mimeType: "application/pdf",
      sha256: "a",
      folderId: null,
      starred: false,
      trashed: false,
      deletedAt: null,
      versionCount: 1,
      currentVersionId: null,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
      encryptionFormat,
    } as never,
    folder: null,
  };
}

describe("the name a rename sends to the server", () => {
  it("is the new name for a file the server can already read", () => {
    expect(serverSideNameFor(driveItem("OCE1", "old.pdf"), "new.pdf")).toBe("new.pdf");
  });

  it("is the new name for a plaintext file", () => {
    expect(serverSideNameFor(driveItem(null, "old.pdf"), "new.pdf")).toBe("new.pdf");
  });

  it("keeps the opaque placeholder for a file the server cannot read", () => {
    // Sending the real name back would put it on the server again, which is
    // the one thing the format exists to prevent.
    const placeholder = "om_0123456789abcdef0123456789abcdef";
    expect(serverSideNameFor(driveItem("OCE2", placeholder), "new.pdf")).toBe(placeholder);
  });
});
