import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaRepos } from "../src/index";

const url = process.env.OMNICLOUD_TEST_DATABASE_URL;

/**
 * Runs only against a real PostgreSQL database given in OMNICLOUD_TEST_DATABASE_URL.
 * Creates and removes its own rows.
 */
describe.skipIf(!url)("restoreSubtree (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let repos: ReturnType<typeof createPrismaRepos>;
  let userId: string;
  let parentId: string;
  let folderId: string;
  let fileId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    repos = createPrismaRepos(prisma, null);
    const user = await prisma.user.create({
      data: {
        telegramUserId: BigInt(Math.floor(Math.random() * 2 ** 52) + 1),
        username: "restore-subtree-test",
      },
    });
    userId = user.id;
    const parent = await prisma.folder.create({ data: { userId, name: "Parent" } });
    parentId = parent.id;
    const folder = await prisma.folder.create({
      data: {
        userId,
        name: "Trashed",
        parentId,
        deletedAt: new Date(),
        trashBatchId: "batch-restore-1",
      },
    });
    folderId = folder.id;
    const file = await prisma.file.create({
      data: {
        userId,
        folderId,
        name: "back.txt",
        size: 1,
        mimeType: "text/plain",
        sha256: "a",
        telegramMessageId: 1,
        deletedAt: new Date(),
        trashBatchId: "batch-restore-1",
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

  it("restores the folder, its file, and reparents the root in one call", async () => {
    await repos.folders.restoreSubtree([folderId], [fileId], {
      rootId: folderId,
      reparent: { parentId: null },
    });

    const folder = await prisma.folder.findUniqueOrThrow({ where: { id: folderId } });
    const file = await prisma.file.findUniqueOrThrow({ where: { id: fileId } });
    expect(folder.deletedAt).toBeNull();
    expect(folder.trashBatchId).toBeNull();
    expect(folder.parentId).toBeNull();
    expect(file.deletedAt).toBeNull();
    expect(file.trashBatchId).toBeNull();
  });
});
