-- Leading indexes on the two foreign keys used by recursive deletes. Without them,
-- PostgreSQL scans the whole table to enforce the constraints and to find children
-- that are looked up without a userId predicate.
CREATE INDEX "Folder_parentId_idx" ON "Folder"("parentId");
CREATE INDEX "File_folderId_idx" ON "File"("folderId");
