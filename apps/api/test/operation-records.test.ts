import { describe, expect, it } from "vitest";
import type { OperationSink } from "@omnicloud/core";
import { createTestHarness, multipartBody } from "./harness";

describe("operation records from the API", () => {
  it("writes an upload.completed record without the file contents", async () => {
    const records: Record<string, unknown>[] = [];
    const sink: OperationSink = {
      info: (record, message) => records.push({ ...record, message }),
      warn: (record, message) => records.push({ ...record, message }),
    };
    const h = await createTestHarness(undefined, undefined, sink);
    const cookie = await h.login("+15550000500");

    const secret = "SECRET-PAYLOAD-BYTES-123";
    const body = multipartBody({}, { name: "rec.txt", data: Buffer.from(secret) });
    const res = await h.app.inject({
      method: "POST",
      url: "/api/files",
      headers: { "content-type": body.contentType },
      payload: body.payload,
      cookies: { omnicloud_session: cookie },
    });
    expect(res.statusCode).toBe(201);

    const upload = records.find((r) => r.message === "upload.completed");
    expect(upload).toBeDefined();
    expect(upload).toMatchObject({ operation: "upload", status: "ok", sizeBytes: secret.length });
    expect(JSON.stringify(records)).not.toContain(secret);
    await h.app.close();
  });
});
