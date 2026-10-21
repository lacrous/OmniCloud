import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaRepos } from "../src/index";

const url = process.env.OMNICLOUD_TEST_DATABASE_URL;

/** A random id per test user, so parallel test files never collide on the unique column. */
const uniqueTelegramId = () => BigInt(Math.floor(Math.random() * 2 ** 52) + 1);

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
      data: { telegramUserId: uniqueTelegramId(), username: "version-number-test" },
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

  it("serializes concurrent replacements without duplicate version numbers", async () => {
    const versionInput = (telegramMessageId: number, sha256: string) => ({
      name: "versions.txt",
      size: 1,
      mimeType: "text/plain",
      sha256,
      telegramMessageId,
      encryptionFormat: null,
      wrappedKey: null,
      metadataBlob: null,
      keyEpoch: null,
      version: { userId, size: 1, mimeType: "text/plain", sha256, telegramMessageId },
    });

    await Promise.all([
      repos.files.replaceWithVersion(fileId, versionInput(200, "replace-a")),
      repos.files.replaceWithVersion(fileId, versionInput(201, "replace-b")),
    ]);

    const versions = await prisma.fileVersion.findMany({
      where: { fileId },
      orderBy: { versionNumber: "asc" },
    });
    const current = await prisma.file.findUnique({ where: { id: fileId } });
    expect(current).not.toBeNull();
    expect(versions.map((version) => version.versionNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(versions.map((version) => version.versionNumber)).size).toBe(5);
    expect(current?.versionCount).toBe(5);
    expect(versions.some((version) => version.id === current?.currentVersionId)).toBe(true);
    expect(current?.sha256).toBe(
      versions.find((version) => version.id === current?.currentVersionId)?.sha256,
    );
  });

  it("a new version after a middle version is pruned gets a number that is not already in use", async () => {
    const versions = await prisma.fileVersion.findMany({
      where: { fileId },
      orderBy: { versionNumber: "asc" },
    });
    // Remove a middle entry, never the highest, so the test stays valid whatever
    // earlier tests left behind.
    const middle = versions[Math.floor(versions.length / 2)]!;
    await repos.files.deleteVersion(fileId, middle.id);

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
    expect(numbers).toContain(created.versionNumber);
    const survivingHighest = Math.max(
      ...versions.filter((v) => v.id !== middle.id).map((v) => v.versionNumber),
    );
    expect(created.versionNumber).toBeGreaterThan(survivingHighest);
  });
});
