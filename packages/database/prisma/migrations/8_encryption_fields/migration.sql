-- Opaque OCE1 encryption metadata on files and versions. The server stores
-- these as opaque strings/ints and never interprets envelope internals.
-- Nullable with no defaults: existing rows are plaintext (null) by definition.
ALTER TABLE "File" ADD COLUMN     "encryptionFormat" TEXT,
ADD COLUMN     "wrappedKey" TEXT,
ADD COLUMN     "metadataBlob" TEXT,
ADD COLUMN     "keyEpoch" INTEGER;

ALTER TABLE "FileVersion" ADD COLUMN     "encryptionFormat" TEXT,
ADD COLUMN     "wrappedKey" TEXT,
ADD COLUMN     "metadataBlob" TEXT,
ADD COLUMN     "keyEpoch" INTEGER;
