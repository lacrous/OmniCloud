-- DropIndex
DROP INDEX "File_userId_folderId_idx";

-- DropIndex
DROP INDEX "Folder_userId_parentId_idx";

-- AlterTable
ALTER TABLE "File" ADD COLUMN     "currentVersionId" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "starred" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "versionCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Folder" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "starred" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "FileVersion" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "size" BIGINT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "telegramMessageId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "resourceName" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FileVersion_fileId_idx" ON "FileVersion"("fileId");

-- CreateIndex
CREATE INDEX "FileVersion_userId_idx" ON "FileVersion"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FileVersion_fileId_versionNumber_key" ON "FileVersion"("fileId", "versionNumber");

-- CreateIndex
CREATE INDEX "ActivityEvent_userId_createdAt_idx" ON "ActivityEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_userId_resourceId_createdAt_idx" ON "ActivityEvent"("userId", "resourceId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_createdAt_idx" ON "ActivityEvent"("createdAt");

-- CreateIndex
CREATE INDEX "File_userId_folderId_deletedAt_idx" ON "File"("userId", "folderId", "deletedAt");

-- CreateIndex
CREATE INDEX "File_userId_deletedAt_idx" ON "File"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "File_userId_starred_idx" ON "File"("userId", "starred");

-- CreateIndex
CREATE INDEX "File_userId_size_idx" ON "File"("userId", "size");

-- CreateIndex
CREATE INDEX "File_userId_mimeType_idx" ON "File"("userId", "mimeType");

-- CreateIndex
CREATE INDEX "Folder_userId_parentId_deletedAt_idx" ON "Folder"("userId", "parentId", "deletedAt");

-- CreateIndex
CREATE INDEX "Folder_userId_deletedAt_idx" ON "Folder"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "Folder_userId_name_idx" ON "Folder"("userId", "name");

-- CreateIndex
CREATE INDEX "Folder_userId_starred_idx" ON "Folder"("userId", "starred");

-- AddForeignKey
ALTER TABLE "FileVersion" ADD CONSTRAINT "FileVersion_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileVersion" ADD CONSTRAINT "FileVersion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: give every pre-v0.2 file a version 1 row so its version history is
-- complete, then point the file at it. Safe to run on an empty table.
INSERT INTO "FileVersion" ("id", "fileId", "userId", "versionNumber", "size", "mimeType", "sha256", "telegramMessageId", "createdAt")
SELECT
  'v1_' || f."id",
  f."id",
  f."userId",
  1,
  f."size",
  f."mimeType",
  f."sha256",
  f."telegramMessageId",
  f."createdAt"
FROM "File" f
WHERE NOT EXISTS (SELECT 1 FROM "FileVersion" v WHERE v."fileId" = f."id");

UPDATE "File" f
SET "currentVersionId" = 'v1_' || f."id", "versionCount" = 1
WHERE f."versionCount" = 0
  AND EXISTS (SELECT 1 FROM "FileVersion" v WHERE v."id" = 'v1_' || f."id");
