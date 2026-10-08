-- CreateTable
CREATE TABLE "UploadOperation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "telegramMessageId" BIGINT,
    "sha256" TEXT,
    "size" BIGINT,
    "fileId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UploadOperation_status_updatedAt_idx" ON "UploadOperation"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UploadOperation_userId_operationId_key" ON "UploadOperation"("userId", "operationId");

-- AddForeignKey
ALTER TABLE "UploadOperation" ADD CONSTRAINT "UploadOperation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

