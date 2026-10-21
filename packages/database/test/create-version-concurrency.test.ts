import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaRepos } from "../src/index";

const url = process.env.OMNICLOUD_TEST_DATABASE_URL;

/** A random id per test user, so parallel test files never collide on the unique column. */
const uniqueTelegramId = () => BigInt(Math.floor(Math.random() * 2 ** 52) + 1);

/**
 * createVersion allocates a version number and moves the parent file's
 * current-version state. Both must hold under concurrency: two creations at
 * once must not collide on the number, and the file must end up describing one
 * of them rather than a stale state.
 *
 * Runs only against a real PostgreSQL database given in OMNICLOUD_TEST_DATABASE_URL.
 */
describe.skipIf(!url)("createVersion (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let repos: ReturnType<typeof createPrismaRepos>;
  let userId: string;
  let fileId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    repos = createPrismaRepos(prisma, null);
    const user = await prisma.user.create({
      data: { telegramUserId: uniqueTelegramId(), username: "create-version-test" },
    });
    userId = user.id;
    const file = await prisma.file.create({
      data: {
        userId,
        folderId: null,
        name: "versions.txt",
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

  const versionInput = (telegramMessageId: number, sha256: string) => ({
    userId,
    size: 1,
    mimeType: "text/plain",
    sha256,
    telegramMessageId,
  });

  it("allocates distinct version numbers to concurrent creations", async () => {
    await Promise.all([
      repos.files.createVersion({ fileId, ...versionInput(201, "one") }),
      repos.files.createVersion({ fileId, ...versionInput(202, "two") }),
      repos.files.createVersion({ fileId, ...versionInput(203, "three") }),
    ]);

    const versions = await prisma.fileVersion.findMany({
      where: { fileId },
      orderBy: { versionNumber: "asc" },
    });
    const numbers = versions.map((version) => version.versionNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers).toEqual([1, 2, 3]);
  });

  it("leaves the parent file describing the version that is current", async () => {
    const versions = await prisma.fileVersion.findMany({
      where: { fileId },
      orderBy: { versionNumber: "asc" },
    });
    const file = await prisma.file.findUniqueOrThrow({ where: { id: fileId } });

    // The parent points at one of the versions that actually exists.
    expect(versions.some((version) => version.id === file.currentVersionId)).toBe(true);
    // And it counts them all.
    expect(file.versionCount).toBe(versions.length);
    // And it describes that version's content, not a stale one.
    const current = versions.find((version) => version.id === file.currentVersionId)!;
    expect(file.sha256).toBe(current.sha256);
    expect(Number(file.size)).toBe(Number(current.size));
    expect(Number(file.telegramMessageId)).toBe(Number(current.telegramMessageId));
  });

  it("a later creation supersedes the parent's current version", async () => {
    const created = await repos.files.createVersion({ fileId, ...versionInput(204, "four") });
    const file = await prisma.file.findUniqueOrThrow({ where: { id: fileId } });

    expect(file.currentVersionId).toBe(created.id);
    expect(file.sha256).toBe("four");
    expect(file.versionCount).toBe(4);
  });
});
