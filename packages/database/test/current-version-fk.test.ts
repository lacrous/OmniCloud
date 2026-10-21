import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaRepos } from "../src/index";

const url = process.env.OMNICLOUD_TEST_DATABASE_URL;

/** A random id per test user, so parallel test files never collide on the unique column. */
const uniqueTelegramId = () => BigInt(Math.floor(Math.random() * 2 ** 52) + 1);

/**
 * The database itself refuses to break the link between a file and the version
 * it points at. The application checks this too, but the constraint is what
 * holds the line if a future caller forgets.
 *
 * Runs only against a real PostgreSQL database given in OMNICLOUD_TEST_DATABASE_URL.
 */
describe.skipIf(!url)("the current-version foreign key (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let repos: ReturnType<typeof createPrismaRepos>;
  let userId: string;
  let fileId: string;
  let versionId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    repos = createPrismaRepos(prisma, null);
    const user = await prisma.user.create({
      data: { telegramUserId: uniqueTelegramId(), username: "current-version-fk" },
    });
    userId = user.id;
    const file = await prisma.file.create({
      data: {
        userId,
        name: "fk.txt",
        size: 1,
        mimeType: "text/plain",
        sha256: "a",
        telegramMessageId: 1,
      },
    });
    fileId = file.id;
    const version = await repos.files.createVersion({
      fileId,
      userId,
      size: 1,
      mimeType: "text/plain",
      sha256: "a",
      telegramMessageId: 1,
    });
    versionId = version.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    }
  });

  it("refuses to point a file at a version that does not exist", async () => {
    await expect(
      prisma.file.update({
        where: { id: fileId },
        data: { currentVersionId: "no-such-version" },
      }),
    ).rejects.toThrow();
  });

  it("refuses to point a file at another file's version", async () => {
    const other = await prisma.file.create({
      data: {
        userId,
        name: "other.txt",
        size: 1,
        mimeType: "text/plain",
        sha256: "b",
        telegramMessageId: 2,
      },
    });
    try {
      await expect(
        prisma.file.update({
          where: { id: other.id },
          data: { currentVersionId: versionId },
        }),
      ).rejects.toThrow();
    } finally {
      await prisma.file.delete({ where: { id: other.id } });
    }
  });

  it("refuses to delete the version a file points at", async () => {
    await expect(prisma.fileVersion.delete({ where: { id: versionId } })).rejects.toThrow();
  });

  it("still deletes a file's versions when the file itself is deleted", async () => {
    const file = await prisma.file.create({
      data: {
        userId,
        name: "cascade.txt",
        size: 1,
        mimeType: "text/plain",
        sha256: "c",
        telegramMessageId: 3,
      },
    });
    const version = await repos.files.createVersion({
      fileId: file.id,
      userId,
      size: 1,
      mimeType: "text/plain",
      sha256: "c",
      telegramMessageId: 3,
    });

    await prisma.file.delete({ where: { id: file.id } });

    const left = await prisma.fileVersion.findMany({ where: { id: version.id } });
    expect(left).toHaveLength(0);
  });
});
