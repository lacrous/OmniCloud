import type {
  ActivityEventDTO,
  ConnectionState,
  FileDTO,
  FileVersionDTO,
  FolderDTO,
  HealthStatus,
  StorageDTO,
  StorageHealthDTO,
  StorageStatsDTO,
  UserDTO,
} from "@omnicloud/shared";
import type {
  ActivityEventRecord,
  FileRecord,
  FileVersionRecord,
  FolderRecord,
  StorageRecord,
  StorageStats,
  UserRecord,
} from "@omnicloud/core";

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
    starred: file.starred,
    trashed: file.deletedAt !== null,
    deletedAt: file.deletedAt ? file.deletedAt.toISOString() : null,
    versionCount: file.versionCount,
    currentVersionId: file.currentVersionId,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
  };
}

export function toFolderDTO(folder: FolderRecord): FolderDTO {
  return {
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    starred: folder.starred,
    trashed: folder.deletedAt !== null,
    deletedAt: folder.deletedAt ? folder.deletedAt.toISOString() : null,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
  };
}

export function toVersionDTO(
  version: FileVersionRecord,
  currentVersionId: string | null,
): FileVersionDTO {
  return {
    id: version.id,
    fileId: version.fileId,
    versionNumber: version.versionNumber,
    size: version.size,
    mimeType: version.mimeType,
    sha256: version.sha256,
    telegramMessageId: version.telegramMessageId,
    isCurrent: version.id === currentVersionId,
    createdAt: version.createdAt.toISOString(),
  };
}

export function toActivityDTO(event: ActivityEventRecord): ActivityEventDTO {
  return {
    id: event.id,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    resourceName: event.resourceName,
    metadata: event.metadata,
    createdAt: event.createdAt.toISOString(),
  };
}

export function toStatsDTO(stats: StorageStats): StorageStatsDTO {
  return {
    fileCount: stats.fileCount,
    folderCount: stats.folderCount,
    totalBytes: stats.totalBytes,
    trashBytes: stats.trashBytes,
    trashFileCount: stats.trashFileCount,
    starredCount: stats.starredCount,
    byType: stats.byType,
    largestFiles: stats.largestFiles.map(toFileDTO),
    quotaBytes: stats.quotaBytes,
  };
}

export function toStorageHealthDTO(input: {
  provider: string;
  state: string;
  healthy: boolean;
  latencyMs: number | null;
  message: string | null;
  targetTitle: string | null;
}): StorageHealthDTO {
  const status: HealthStatus = input.healthy
    ? "healthy"
    : input.state === "ERROR" || input.state === "AUTH_REQUIRED"
      ? "unavailable"
      : "degraded";
  return {
    provider: input.provider,
    state: input.state as ConnectionState,
    status,
    latencyMs: input.latencyMs,
    message: input.message,
    channelTitle: input.targetTitle,
    checkedAt: new Date().toISOString(),
  };
}
