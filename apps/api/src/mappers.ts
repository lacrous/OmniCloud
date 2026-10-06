import type { FileDTO, FolderDTO, StorageDTO, UserDTO } from "@omnicloud/shared";
import type { FileRecord, FolderRecord, StorageRecord, UserRecord } from "@omnicloud/core";

export function toUserDTO(user: UserRecord): UserDTO {
  return {
    id: user.id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
  };
}

export function toStorageDTO(storage: StorageRecord): StorageDTO {
  return {
    id: storage.id,
    provider: storage.provider,
    title: storage.title,
    createdAt: storage.createdAt.toISOString(),
  };
}

export function toFileDTO(file: FileRecord): FileDTO {
  return {
    id: file.id,
    name: file.name,
    size: file.size,
    mimeType: file.mimeType,
    sha256: file.sha256,
    folderId: file.folderId,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
  };
}

export function toFolderDTO(folder: FolderRecord): FolderDTO {
  return {
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
  };
}
