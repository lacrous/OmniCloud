-- Opaque OCE1 recovery blob on the user. The server stores this ciphertext
-- but can never open it: opening requires the user-held recovery code.
-- Nullable: most users have no recovery record.
ALTER TABLE "User" ADD COLUMN "recoveryBlob" TEXT;
