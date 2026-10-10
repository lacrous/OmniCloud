import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaRepos } from "../src/index";

const url = process.env.OMNICLOUD_TEST_DATABASE_URL;

/** A random id per test user, so parallel test files never collide on the unique column. */
const uniqueTelegramId = () => BigInt(Math.floor(Math.random() * 2 ** 52) + 1);

/**
 * Runs only against a real PostgreSQL database given in OMNICLOUD_TEST_DATABASE_URL.
 * It creates its own user, file and versions, and deletes them afterwards.
 */
describe.skipIf(!url)("deleteVersion (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let repos: ReturnType<typeof createPrismaRepos>;
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    repos = createPrismaRepos(prisma, null);
    const user = await prisma.user.create({
      data: { telegramUserId: uniqueTelegramId(), username: "version-delete-test" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    }
  });

  it("removes exactly the named version and leaves its siblings", async () => {
    const file = await prisma.file.create({
      data: {
        userId,
        name: "delete-me.txt",
        size: 1,
        mimeType: "text/plain",
        sha256: "a",
        telegramMessageId: 1,
      },
    });
    const made = await Promise.all(
      [1, 2, 3].map((n) =>
        prisma.fileVersion.create({
          data: {
            fileId: file.id,
            userId,
            versionNumber: n,
            size: 1,
            mimeType: "text/plain",
            sha256: `s${n}`,
            telegramMessageId: 100 + n,
          },
        }),
      ),
    );

    await repos.files.deleteVersion(made[1]!.id);

    const left = await prisma.fileVersion.findMany({
      where: { fileId: file.id },
      orderBy: { versionNumber: "asc" },
    });
    expect(left.map((v) => v.versionNumber)).toEqual([1, 3]);
  });
});
