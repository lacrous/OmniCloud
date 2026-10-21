-- Foreign key from a file to the version it currently points at.
--
-- The pointer was a bare string, so the database could not tell whether it
-- referred to a real version of that file. The application checked, but the
-- constraint now holds the line as well.
--
-- Before the constraint is added, pointers that do not resolve are cleared:
-- a file whose current version is missing, or points at another file's
-- version, has no coherent current version to point at, and leaving the
-- pointer would make the constraint fail to apply.
UPDATE "File" f
   SET "currentVersionId" = NULL
 WHERE f."currentVersionId" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "FileVersion" v
      WHERE v.id = f."currentVersionId" AND v."fileId" = f.id
   );

-- The index is needed for the constraint to be enforced without scanning the
-- whole table on every version delete, and it is unique because a version
-- belongs to exactly one file: at most one file can point at it.
CREATE UNIQUE INDEX "File_currentVersionId_key" ON "File"("currentVersionId");

-- NoAction rather than Cascade or SetNull: deleting a file still cascades to
-- its versions, and deleting a version that a file points at is refused
-- instead of silently clearing the pointer. The application's own check says
-- the same thing, so the two agree.
ALTER TABLE "File"
  ADD CONSTRAINT "File_currentVersionId_fkey"
  FOREIGN KEY ("currentVersionId") REFERENCES "FileVersion"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
