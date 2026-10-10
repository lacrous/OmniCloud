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
describe.skipIf(!url)("upload operation request fingerprint (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let repos: ReturnType<typeof createPrismaRepos>;
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    repos = createPrismaRepos(prisma, null);
    const user = await prisma.user.create({
      data: { telegramUserId: uniqueTelegramId(), username: "fingerprint-test" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    }
  });

  it("stores the fingerprint with the operation and reads it back unchanged", async () => {
    const fingerprint = "a".repeat(64);
    const created = await repos.uploadOperations.create({
      userId,
      operationId: "fingerprint_roundtrip_0001",
      requestFingerprint: fingerprint,
    });
    expect(created.requestFingerprint).toBe(fingerprint);

    const read = await repos.uploadOperations.findByOperationId(
      userId,
      "fingerprint_roundtrip_0001",
    );
    expect(read?.requestFingerprint).toBe(fingerprint);
  });

  it("an operation created without a fingerprint stores null, as before this release", async () => {
    const created = await repos.uploadOperations.create({
      userId,
      operationId: "fingerprint_legacy_0002",
    });
    expect(created.requestFingerprint).toBeNull();
  });
});
