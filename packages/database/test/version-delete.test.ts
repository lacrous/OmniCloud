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

    await repos.files.deleteVersion(file.id, made[1]!.id);

    const left = await prisma.fileVersion.findMany({
      where: { fileId: file.id },
      orderBy: { versionNumber: "asc" },
    });
    expect(left.map((v) => v.versionNumber)).toEqual([1, 3]);
  });

  it("refuses to delete the version the file points at", async () => {
    const file = await prisma.file.create({
      data: {
        userId,
        name: "current.txt",
        size: 1,
        mimeType: "text/plain",
        sha256: "a",
        telegramMessageId: 1,
      },
    });
    const current = await repos.files.createVersion({
      fileId: file.id,
      userId,
      size: 1,
      mimeType: "text/plain",
      sha256: "s1",
      telegramMessageId: 11,
    });
    await prisma.file.update({
      where: { id: file.id },
      data: { currentVersionId: current.id, versionCount: 1 },
    });

    await expect(repos.files.deleteVersion(file.id, current.id)).rejects.toThrow(
      /current version cannot be deleted/i,
    );
    const left = await prisma.fileVersion.findMany({ where: { fileId: file.id } });
    expect(left).toHaveLength(1);
  });

  it("decrements the version count exactly once per delete, even when deletes race", async () => {
    const file = await prisma.file.create({
      data: {
        userId,
        name: "counted.txt",
        size: 1,
        mimeType: "text/plain",
        sha256: "a",
        telegramMessageId: 1,
        versionCount: 0,
      },
    });
    // Created one at a time, so which version the file points at is known.
    const made = [];
    for (const n of [1, 2, 3, 4]) {
      made.push(
        await repos.files.createVersion({
          fileId: file.id,
          userId,
          size: 1,
          mimeType: "text/plain",
          sha256: `c${n}`,
          telegramMessageId: 100 + n,
        }),
      );
    }
    const current = made[made.length - 1]!;

    // The three historical versions are removed at once. The count must end up
    // reflecting exactly three removals, not fewer.
    const toRemove = made.filter((v) => v.id !== current.id);
    expect(toRemove).toHaveLength(3);
    await Promise.all(toRemove.map((version) => repos.files.deleteVersion(file.id, version.id)));

    const after = await prisma.file.findUniqueOrThrow({ where: { id: file.id } });
    const left = await prisma.fileVersion.findMany({ where: { fileId: file.id } });
    expect(left).toHaveLength(1);
    expect(after.versionCount).toBe(1);
  });
});
