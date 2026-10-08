export * from "./errors";
export * from "./types";
export * from "./repos";
export * from "./storage/provider";
export * from "./storage/engine";
export * from "./services/query-resolver";
export * from "./services/activity-service";
export * from "./services/file-service";
export * from "./services/folder-service";
export * from "./services/search-service";
export * from "./services/stats-service";
export * from "./services/trash-service";
export * from "./services/integrity-service";
export * from "./services/recent-service";
export * from "./utils/filename";
export * from "./utils/hash";

// Re-export the shared vocabulary the persistence layer maps onto, so
// consumers (database, telegram, api) have a single import for domain types.
export type {
  ActivityAction,
  ActivityEventDTO,
  BatchFileOperation,
  BatchFolderOperation,
  BatchResultDTO,
  ConnectionState,
  EmptyTrashResultDTO,
  ErrorCode,
  FileCategory,
  FileDTO,
  FileVersionDTO,
  FolderDTO,
  FoldersPageDTO,
  FolderMutationResultDTO,
  FilesPageDTO,
  HealthStatus,
  IntegrityIssueDTO,
  IntegrityReportDTO,
  ItemStatus,
  ListQuery,
  PaginationDTO,
  RecentItemDTO,
  RecentPageDTO,
  ResourceType,
  SearchResultDTO,
  SortField,
  SortOrder,
  StorageHealthDTO,
  StorageStatsDTO,
  StorageTypeBreakdownDTO,
  TrashPageDTO,
  UserDTO,
} from "@omnicloud/shared";
export { ERROR_CODES, fileCategory, mimeFromFilename } from "@omnicloud/shared";
