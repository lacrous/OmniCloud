import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaRepos } from "../src/index";

const url = process.env.OMNICLOUD_TEST_DATABASE_URL;

/**
 * Runs only against a real PostgreSQL database given in OMNICLOUD_TEST_DATABASE_URL.
 * Creates and removes its own rows.
 */
describe.skipIf(!url)("UNKNOWN upload status (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let repos: ReturnType<typeof createPrismaRepos>;
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    repos = createPrismaRepos(prisma, null);
    const user = await prisma.user.create({
      data: {
        telegramUserId: BigInt(Math.floor(Math.random() * 2 ** 52) + 1),
        username: "unknown-status-test",
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    }
  });

  it("stores and reads back an UNKNOWN operation, and does not let a new request claim it", async () => {
    const op = await repos.uploadOperations.create({ userId, operationId: "unknown_pg_0001" });
    expect(await repos.uploadOperations.claim(op.id, "PENDING", "UPLOADING")).toBe(true);
    expect(await repos.uploadOperations.claim(op.id, "UPLOADING", "UNKNOWN")).toBe(true);

    const read = await repos.uploadOperations.findByOperationId(userId, "unknown_pg_0001");
    expect(read?.status).toBe("UNKNOWN");
    expect(await repos.uploadOperations.claim(op.id, "PENDING", "UPLOADING")).toBe(false);
    expect(await repos.uploadOperations.claim(op.id, "FAILED", "UPLOADING")).toBe(false);
  });
});
