import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaRepos } from "../src/index";

const url = process.env.OMNICLOUD_TEST_DATABASE_URL;

/** A random id per test user, so parallel test files never collide on the unique column. */
const uniqueTelegramId = () => BigInt(Math.floor(Math.random() * 2 ** 52) + 1);

/**
 * Runs only against a real PostgreSQL database given in OMNICLOUD_TEST_DATABASE_URL
 * (a disposable one: the test creates and deletes its own rows). The default
 * suite never touches a database.
 */
describe.skipIf(!url)("folder move under concurrency (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let repos: ReturnType<typeof createPrismaRepos>;
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    repos = createPrismaRepos(prisma, null);
    const user = await prisma.user.create({
      data: { telegramUserId: uniqueTelegramId(), username: "race-test" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    }
  });

  async function attemptMove(folderId: string, parentId: string): Promise<"moved" | "rejected"> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await repos.folders.moveSafely(folderId, parentId);
        return "moved";
      } catch (error) {
        const message = String((error as Error).message);
        if (/subfolders/.test(message)) return "rejected";
        if ((error as { code?: string }).code === "P2034") continue;
        throw error;
      }
    }
    throw new Error("move never settled");
  }

  it("two concurrent cross-moves never create a cycle", async () => {
    for (let round = 0; round < 5; round += 1) {
      const a = await prisma.folder.create({ data: { userId, name: `A${round}` } });
      const b = await prisma.folder.create({ data: { userId, name: `B${round}` } });

      const results = await Promise.all([attemptMove(a.id, b.id), attemptMove(b.id, a.id)]);

      const fa = await prisma.folder.findUnique({ where: { id: a.id } });
      const fb = await prisma.folder.findUnique({ where: { id: b.id } });
      const cycle = fa?.parentId === b.id && fb?.parentId === a.id;
      expect(cycle).toBe(false);
      expect(results.filter((r) => r === "moved")).toHaveLength(1);
    }
  });
});
