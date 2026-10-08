/**
 * Development seed.
 *
 * Creates a local user with a storage registration and a small folder/file
 * tree so the Drive UI has something to show without connecting Telegram.
 *
 *   pnpm db:seed
 *
 * WARNING: development only. It writes rows directly and never touches
 * Telegram, so seeded files have no real remote objects (integrity checks will
 * report them as missing — that is expected).
 */
import { createPrismaClient, createPrismaRepos } from "../src/index";

const TELEGRAM_PROVIDER = "telegram";

interface SeedFile {
  name: string;
  size: number;
  mimeType: string;
  folder?: string;
}

const FOLDERS = ["Documents", "Pictures", "Projects"];

const FILES: SeedFile[] = [
  { name: "CV.pdf", size: 184_320, mimeType: "application/pdf", folder: "Documents" },
  { name: "Contract.pdf", size: 512_000, mimeType: "application/pdf", folder: "Documents" },
  { name: "notes.txt", size: 2_048, mimeType: "text/plain", folder: "Documents" },
  { name: "Photo.jpg", size: 2_411_724, mimeType: "image/jpeg", folder: "Pictures" },
  { name: "Screenshot.png", size: 840_000, mimeType: "image/png", folder: "Pictures" },
  { name: "project.zip", size: 12_582_912, mimeType: "application/zip", folder: "Projects" },
  { name: "README.md", size: 4_096, mimeType: "text/markdown" },
];

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  const repos = createPrismaRepos(prisma);

  const user = await repos.users.upsertFromTelegram({
    telegramUserId: "100000001",
    username: "dev",
    firstName: "Dev",
    lastName: "User",
    phone: "+10000000001",
  });

  const existingStorage = await repos.storages.findByUserAndProvider(user.id, TELEGRAM_PROVIDER);
  if (!existingStorage) {
    await repos.storages.create({
      userId: user.id,
      provider: TELEGRAM_PROVIDER,
      title: "OmniCloud Storage (seed)",
      telegramChatId: "-1001000000001",
      telegramAccessHash: "1000000001",
    });
  }

  const existingFolders = await repos.folders.listByUser(user.id);
  const folderIds = new Map<string, string>();
  for (const name of FOLDERS) {
    const found = existingFolders.find((folder) => folder.name === name);
    folderIds.set(
      name,
      found
        ? found.id
        : (
            await repos.folders.create({
              userId: user.id,
              parentId: null,
              name,
            })
          ).id,
    );
  }

  if (existingFolders.length === 0) {
    let messageId = 1_000_000;
    for (const file of FILES) {
      const record = await repos.files.create({
        userId: user.id,
        folderId: file.folder ? (folderIds.get(file.folder) ?? null) : null,
        name: file.name,
        size: file.size,
        mimeType: file.mimeType,
        // Placeholder checksum — seeded files have no real content.
        sha256: `seed${String(messageId).padStart(60, "0")}`,
        telegramMessageId: messageId,
      });
      const version = await repos.files.createVersion({
        fileId: record.id,
        userId: user.id,
        size: file.size,
        mimeType: file.mimeType,
        sha256: record.sha256,
        telegramMessageId: messageId,
      });
      await repos.files.update(record.id, { currentVersionId: version.id, versionCount: 1 });
      messageId += 1;
    }
  }

  console.log(
    `Seeded user ${user.username} (${user.id}) with ${folderIds.size} folders and ` +
      `${FOLDERS.length > 0 ? FILES.length : 0} files.`,
  );
  console.log(
    "Note: seeded files have no Telegram objects — data access will report them missing.",
  );

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
