import { describe, expect, it } from "vitest";
import { ReconciliationService } from "../src/services/reconciliation-service";
import type { StorageEngine } from "../src/storage/engine";
import { createInMemoryRepos, makeUser } from "./fakes";

describe("an object held by a COMMITTING operation", () => {
  it("is not reported as an unknown orphan", async () => {
    const repos = createInMemoryRepos();
    const user = makeUser();
    const op = await repos.uploadOperations.create({
      userId: user.id,
      operationId: "committing_0001",
    });
    await repos.uploadOperations.claim(op.id, "PENDING", "UPLOADING");
    await repos.uploadOperations.update(op.id, { telegramMessageId: 9001 });
    await repos.uploadOperations.claim(op.id, "UPLOADING", "COMMITTING");

    const engine = {
      list: async () => [
        { messageId: "9001", name: "x.bin", size: 1, mimeType: "application/octet-stream" },
      ],
    };
    const service = new ReconciliationService(
      repos,
      async () => engine as unknown as StorageEngine,
    );

    const report = await service.run(user.id);
    expect(report.unknown.map((u) => u.messageId)).not.toContain(9001);
  });
});
