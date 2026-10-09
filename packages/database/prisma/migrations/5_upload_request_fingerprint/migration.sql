-- Binds an upload idempotency key to the request that created it. Nullable so
-- operations created before this migration keep their existing behaviour.
ALTER TABLE "UploadOperation" ADD COLUMN "requestFingerprint" TEXT;
