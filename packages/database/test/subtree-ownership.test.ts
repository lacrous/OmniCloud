import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaRepos } from "../src/index";

const url = process.env.OMNICLOUD_TEST_DATABASE_URL;

/** A random id per test user, so parallel test files never collide on the unique column. */
const uniqueTelegramId = () => BigInt(Math.floor(Math.random() * 2 ** 52) + 1);

/**
 * The subtree writes are scoped to the owner, so knowing another account's
 * ids is not enough to trash or restore its items. The service layer checks
 * ownership too, but this proves the predicate is in the SQL itself.
 *
 * Runs only against a real PostgreSQL database given in OMNICLOUD_TEST_DATABASE_URL.
 */
describe.skipIf(!url)("subtree ownership (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let repos: ReturnType<typeof createPrismaRepos>;
  let ownerId: string;
  let strangerId: string;
  let folderId: string;
  let fileId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    repos = createPrismaRepos(prisma, null);
    const owner = await prisma.user.create({
      data: { telegramUserId: uniqueTelegramId(), username: "subtree-owner" },
    });
    const stranger = await prisma.user.create({
      data: { telegramUserId: uniqueTelegramId(), username: "subtree-stranger" },
    });
    ownerId = owner.id;
    strangerId = stranger.id;
    const folder = await prisma.folder.create({ data: { userId: ownerId, name: "Theirs" } });
    folderId = folder.id;
    const file = await prisma.file.create({
      data: {
        userId: ownerId,
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
      await prisma.user.deleteMany({ where: { id: { in: [ownerId, strangerId] } } });
      await prisma.$disconnect();
    }
  });

  it("does not trash another account's folder or file", async () => {
    const stamp = { deletedAt: new Date(), trashBatchId: "batch-idor" };
    await repos.folders.trashSubtree(strangerId, [folderId], [fileId], stamp);

    const folder = await prisma.folder.findUniqueOrThrow({ where: { id: folderId } });
    const file = await prisma.file.findUniqueOrThrow({ where: { id: fileId } });
    expect(folder.deletedAt).toBeNull();
    expect(folder.trashBatchId).toBeNull();
    expect(file.deletedAt).toBeNull();
    expect(file.trashBatchId).toBeNull();
  });

  it("does not restore or reparent another account's folder or file", async () => {
    // Trash it properly first, as the owner.
    await repos.folders.trashSubtree(ownerId, [folderId], [fileId], {
      deletedAt: new Date(),
      trashBatchId: "batch-owner",
    });
    const target = await prisma.folder.create({ data: { userId: ownerId, name: "Target" } });

    await repos.folders.restoreSubtree(strangerId, [folderId], [fileId], {
      rootId: folderId,
      reparent: { parentId: target.id },
    });

    const folder = await prisma.folder.findUniqueOrThrow({ where: { id: folderId } });
    const file = await prisma.file.findUniqueOrThrow({ where: { id: fileId } });
    expect(folder.deletedAt).not.toBeNull();
    expect(folder.parentId).toBeNull();
    expect(file.deletedAt).not.toBeNull();

    // Put it back so the next run starts from a clean state.
    await repos.folders.restoreSubtree(ownerId, [folderId], [fileId], {
      rootId: folderId,
      reparent: { parentId: null },
    });
    await prisma.folder.delete({ where: { id: target.id } });
  });

  it("trashes and restores the owner's own subtree", async () => {
    const stamp = { deletedAt: new Date(), trashBatchId: "batch-own" };
    await repos.folders.trashSubtree(ownerId, [folderId], [fileId], stamp);

    let folder = await prisma.folder.findUniqueOrThrow({ where: { id: folderId } });
    let file = await prisma.file.findUniqueOrThrow({ where: { id: fileId } });
    expect(folder.deletedAt).not.toBeNull();
    expect(file.deletedAt).not.toBeNull();

    await repos.folders.restoreSubtree(ownerId, [folderId], [fileId], {
      rootId: folderId,
      reparent: { parentId: null },
    });

    folder = await prisma.folder.findUniqueOrThrow({ where: { id: folderId } });
    file = await prisma.file.findUniqueOrThrow({ where: { id: fileId } });
    expect(folder.deletedAt).toBeNull();
    expect(file.deletedAt).toBeNull();
  });
});
