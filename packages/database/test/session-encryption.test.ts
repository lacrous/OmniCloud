import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SecretBox, deriveKey } from "@omnicloud/core";
import { createPrismaRepos } from "../src/index";

type Row = { userId: string; stringSession: string };

/** The subset of PrismaClient that the session repository uses, backed by a Map. */
function fakePrisma() {
  const rows = new Map<string, Row>();
  const telegramSession = {
    async findUnique({ where }: { where: { userId: string } }) {
      return rows.get(where.userId) ?? null;
    },
    async upsert({
      where,
      update,
      create,
    }: {
      where: { userId: string };
      update: { stringSession: string };
      create: Row;
    }) {
      const existing = rows.get(where.userId);
      const next = existing
        ? { ...existing, ...update }
        : { userId: create.userId, stringSession: create.stringSession };
      rows.set(where.userId, next);
      return next;
    },
    async update({ where, data }: { where: { userId: string }; data: { stringSession: string } }) {
      const row = { ...rows.get(where.userId)!, ...data };
      rows.set(where.userId, row);
      return row;
    },
    async deleteMany({ where }: { where: { userId: string } }) {
      rows.delete(where.userId);
      return { count: 1 };
    },
  };
  return { prisma: { telegramSession } as never, rows };
}

const SESSION = "AQAAAAAAAAACAAAAAgAAAAA+example+base64+session==";
const box = () => new SecretBox([{ version: 1, key: deriveKey(randomBytes(32).toString("hex")) }]);

describe("Telegram session encryption at rest", () => {
  it("never stores a session string in plaintext", async () => {
    const { prisma, rows } = fakePrisma();
    const repos = createPrismaRepos(prisma, box());

    await repos.sessions.save("u1", SESSION);

    expect(rows.get("u1")!.stringSession).not.toContain(SESSION);
    expect(rows.get("u1")!.stringSession.startsWith("v1:")).toBe(true);
  });

  it("returns the original session on read", async () => {
    const { prisma } = fakePrisma();
    const repos = createPrismaRepos(prisma, box());

    await repos.sessions.save("u1", SESSION);
    expect((await repos.sessions.get("u1"))!.stringSession).toBe(SESSION);
  });

  it("re-seals a legacy plaintext session on first read", async () => {
    const { prisma, rows } = fakePrisma();
    rows.set("u1", { userId: "u1", stringSession: SESSION });
    const repos = createPrismaRepos(prisma, box());

    expect((await repos.sessions.get("u1"))!.stringSession).toBe(SESSION);
    expect(rows.get("u1")!.stringSession.startsWith("v1:")).toBe(true);
    expect(rows.get("u1")!.stringSession).not.toContain(SESSION);
  });

  it("fails rather than returning a sealed value it cannot open", async () => {
    const { prisma, rows } = fakePrisma();
    const writer = createPrismaRepos(prisma, box());
    await writer.sessions.save("u1", SESSION);

    const wrongKey = createPrismaRepos(prisma, box());
    await expect(wrongKey.sessions.get("u1")).rejects.toThrow();
    expect(rows.get("u1")!.stringSession).not.toContain(SESSION);
  });

  it("stores unsealed only when no key is configured", async () => {
    const { prisma, rows } = fakePrisma();
    const repos = createPrismaRepos(prisma, null);

    await repos.sessions.save("u1", SESSION);
    expect(rows.get("u1")!.stringSession).toBe(SESSION);
  });
});
