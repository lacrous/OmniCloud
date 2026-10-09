import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaRepos } from "../src/index";

const url = process.env.OMNICLOUD_TEST_DATABASE_URL;

/**
 * Runs only against a real PostgreSQL database given in OMNICLOUD_TEST_DATABASE_URL.
 * Creates and removes its own rows.
 */
describe.skipIf(!url)("version numbers after pruning (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let repos: ReturnType<typeof createPrismaRepos>;
  let userId: string;
  let fileId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    repos = createPrismaRepos(prisma, null);
    const user = await prisma.user.create({
      data: { telegramUserId: BigInt(Date.now()), username: "version-number-test" },
    });
    userId = user.id;
    const file = await prisma.file.create({
      data: {
        userId,
        name: "versions.txt",
        size: 1,
        mimeType: "text/plain",
        sha256: "a",
        telegramMessageId: 1,
      },
    });
    fileId = file.id;
    for (const n of [1, 2, 3]) {
      await prisma.fileVersion.create({
        data: {
          fileId,
          userId,
          versionNumber: n,
          size: 1,
          mimeType: "text/plain",
          sha256: `s${n}`,
          telegramMessageId: 100 + n,
        },
      });
    }
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    }
  });

  it("a new version after a middle version is pruned gets a number that is not already in use", async () => {
    const versions = await prisma.fileVersion.findMany({
      where: { fileId },
      orderBy: { versionNumber: "asc" },
    });
    await repos.files.deleteVersion(versions[1]!.id);

    const created = await repos.files.createVersion({
      fileId,
      userId,
      size: 1,
      mimeType: "text/plain",
      sha256: "new",
      telegramMessageId: 999,
    });

    const numbers = (await prisma.fileVersion.findMany({ where: { fileId } })).map(
      (v) => v.versionNumber,
    );
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(created.versionNumber).toBe(4);
  });
});
