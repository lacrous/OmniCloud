import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaRepos } from "../src/index";

const url = process.env.OMNICLOUD_TEST_DATABASE_URL;

/**
 * Runs only against a real PostgreSQL database given in OMNICLOUD_TEST_DATABASE_URL.
 * Creates and removes its own rows.
 */
describe.skipIf(!url)("trashSubtree (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let repos: ReturnType<typeof createPrismaRepos>;
  let userId: string;
  let folderId: string;
  let fileId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    repos = createPrismaRepos(prisma, null);
    const user = await prisma.user.create({
      data: { telegramUserId: BigInt(Date.now()), username: "trash-subtree-test" },
    });
    userId = user.id;
    const folder = await prisma.folder.create({ data: { userId, name: "Trash me" } });
    folderId = folder.id;
    const file = await prisma.file.create({
      data: {
        userId,
        folderId,
        name: "inside.txt",
        size: 1,
        mimeType: "text/plain",
        sha256: "a",
        telegramMessageId: 1,
      },
    });
    fileId = file.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    }
  });

  it("stamps the folder and its file with the same batch in one call", async () => {
    const stamp = { deletedAt: new Date(), trashBatchId: "batch-pg-1" };
    await repos.folders.trashSubtree([folderId], [fileId], stamp);

    const folder = await prisma.folder.findUniqueOrThrow({ where: { id: folderId } });
    const file = await prisma.file.findUniqueOrThrow({ where: { id: fileId } });
    expect(folder.trashBatchId).toBe("batch-pg-1");
    expect(file.trashBatchId).toBe("batch-pg-1");
    expect(folder.deletedAt).not.toBeNull();
    expect(file.deletedAt).not.toBeNull();
  });
});
