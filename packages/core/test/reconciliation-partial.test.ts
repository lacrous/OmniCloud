import { describe, expect, it } from "vitest";
import { reconcile } from "../src/services/reconciliation";
import { ReconciliationService } from "../src/services/reconciliation-service";
import type { StorageEngine } from "../src/storage/engine";
import { createInMemoryRepos, makeUser } from "./fakes";

describe("a scan that hit its cap is reported as partial", () => {
  it("marks the report truncated when the channel listing filled the limit", async () => {
    const repos = createInMemoryRepos();
    const user = makeUser();
    // A listing that returns exactly as many objects as the cap allows.
    const many = Array.from({ length: 5 }, (_, i) => ({
      messageId: String(1000 + i),
      name: `f${i}`,
      size: 1,
      mimeType: "application/octet-stream",
    }));
    const engine = { list: async (limit: number) => many.slice(0, limit) };

    const service = new ReconciliationService(
      repos,
      async () => engine as unknown as StorageEngine,
    );
    const report = await service.run(user.id, { limit: 5 });
    expect(report.truncated).toBe(true);
    expect(report.limit).toBe(5);
  });

  it("marks a short scan as complete", async () => {
    const repos = createInMemoryRepos();
    const user = makeUser();
    const engine = {
      list: async () => [
        { messageId: "1", name: "a", size: 1, mimeType: "application/octet-stream" },
      ],
    };
    const service = new ReconciliationService(
      repos,
      async () => engine as unknown as StorageEngine,
    );
    const report = await service.run(user.id, { limit: 50 });
    expect(report.truncated).toBe(false);
    expect(report.limit).toBe(50);
  });

  it("carries the flag through the pure classifier", () => {
    const report = reconcile(
      [],
      { fileMessageIds: new Set(), pendingUploadMessageIds: new Set() },
      {
        limit: 10,
        truncated: true,
      },
    );
    expect(report.truncated).toBe(true);
  });
});
