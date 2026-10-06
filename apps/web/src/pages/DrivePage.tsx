import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ERROR_CODES } from "@omnicloud/shared";
import type { FileDTO, FolderDTO } from "@omnicloud/shared";
import { api, ApiError, errorMessage } from "../api/client";
import { uploadFile } from "../api/upload";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useFolderContent } from "../hooks/useFolderContent";
import { useMe } from "../hooks/useMe";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DeleteFolderDialog } from "../components/DeleteFolderDialog";
import { FileList } from "../components/FileList";
import type { FileAction } from "../components/FileList";
import { FolderList } from "../components/FolderList";
import type { FolderAction } from "../components/FolderList";
import { MoveDialog } from "../components/MoveDialog";
import type { MoveTarget } from "../components/MoveDialog";
import { NameDialog } from "../components/NameDialog";
import { useToast } from "../components/Toasts";
import { UploadsPanel } from "../components/UploadsPanel";
import type { UploadItem } from "../components/UploadsPanel";
import {
  CloudIcon,
  FolderIcon,
  LogoutIcon,
  NewFolderIcon,
  SearchIcon,
  Spinner,
  UploadIcon,
  XIcon,
} from "../components/icons";
import {
  ME_QUERY_KEY,
  SIGNED_OUT_SESSION,
  TREE_QUERY_KEY,
  invalidateDriveQueries,
} from "../lib/queries";
import { breadcrumbPath, buildFolderTree } from "../lib/tree";
import StorageInit from "./StorageInit";

let uploadIdCounter = 0;

type RenameTarget = { kind: "file" | "folder"; id: string; name: string };

function hasDraggedFiles(event: DragEvent<HTMLElement>): boolean {
  return event.dataTransfer.types.includes("Files");
}

export default function DrivePage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const folderId = searchParams.get("folder");
  const storage = me.data?.storage ?? null;

  // ── Search ────────────────────────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const searchQuery = debouncedSearch.trim();

  // ── Drag-and-drop state ───────────────────────────────────────────────────
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  // ── Upload queue ──────────────────────────────────────────────────────────
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const uploadTimers = useRef(new Set<number>());
  const uploadQueue = useRef<Promise<void>>(Promise.resolve());
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Dialog state ──────────────────────────────────────────────────────────
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);
  const [moving, setMoving] = useState<MoveTarget | null>(null);
  const [deletingFile, setDeletingFile] = useState<FileDTO | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<FolderDTO | null>(null);

  // ── Data ──────────────────────────────────────────────────────────────────
  const content = useFolderContent(folderId, storage !== null);
  const treeQuery = useQuery({
    queryKey: TREE_QUERY_KEY,
    queryFn: api.folders.tree,
    enabled: storage !== null,
  });

  const tree = useMemo(() => buildFolderTree(treeQuery.data?.folders ?? []), [treeQuery.data]);
  const breadcrumbs = useMemo(() => breadcrumbPath(tree, folderId), [tree, folderId]);

  const searchResults = useQuery({
    queryKey: ["search", searchQuery],
    queryFn: () => api.search(searchQuery),
    enabled: searchQuery !== "",
    placeholderData: keepPreviousData,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const logoutMutation = useMutation({
    mutationFn: api.auth.logout,
    onSuccess: () => {
      queryClient.setQueryData(ME_QUERY_KEY, SIGNED_OUT_SESSION);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "me" });
    },
    onError: (error) => toast.error(errorMessage(error, "Could not sign out")),
  });

  const createFolderMutation = useMutation({
    mutationFn: (name: string) => api.folders.create(name, folderId),
    onSuccess: () => {
      invalidateDriveQueries(queryClient);
      setCreateFolderOpen(false);
      toast.success("Folder created");
    },
    onError: (error) => toast.error(errorMessage(error, "Could not create folder")),
  });

  const renameMutation = useMutation({
    mutationFn: ({
      kind,
      id,
      name,
    }: RenameTarget): Promise<{ file: FileDTO } | { folder: FolderDTO }> =>
      kind === "file" ? api.files.rename(id, name) : api.folders.rename(id, name),
    onSuccess: (_result, variables) => {
      invalidateDriveQueries(queryClient);
      setRenaming(null);
      toast.success(`Renamed to "${variables.name}"`);
    },
    onError: (error) => toast.error(errorMessage(error, "Could not rename item")),
  });

  const deleteFileMutation = useMutation({
    mutationFn: (file: FileDTO) => api.files.delete(file.id),
    onSuccess: (_result, file) => {
      invalidateDriveQueries(queryClient);
      setDeletingFile(null);
      toast.success(`Deleted "${file.name}"`);
    },
    onError: (error) => toast.error(errorMessage(error, "Could not delete file")),
  });

  // ── Uploads ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const timers = uploadTimers.current;
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, []);

  const runUpload = useCallback(
    async (id: number, file: File, targetFolderId: string | null): Promise<void> => {
      try {
        await uploadFile(file, targetFolderId, (percent) => {
          setUploads((prev) =>
            prev.map((entry) => (entry.id === id ? { ...entry, percent } : entry)),
          );
        });
        setUploads((prev) =>
          prev.map((entry) =>
            entry.id === id ? { ...entry, status: "done", percent: 100 } : entry,
          ),
        );
        void queryClient.invalidateQueries({ queryKey: ["files"] });
        const timer = window.setTimeout(() => {
          uploadTimers.current.delete(timer);
          setUploads((prev) => prev.filter((entry) => entry.id !== id));
        }, 4000);
        uploadTimers.current.add(timer);
      } catch (error) {
        setUploads((prev) =>
          prev.map((entry) =>
            entry.id === id
              ? { ...entry, status: "error", message: errorMessage(error, "Upload failed") }
              : entry,
          ),
        );
        toast.error(`Could not upload "${file.name}": ${errorMessage(error, "upload failed")}`);
      }
    },
    [queryClient, toast],
  );

  const enqueueUploads = useCallback(
    (files: File[], targetFolderId: string | null) => {
      for (const file of files) {
        uploadIdCounter += 1;
        const id = uploadIdCounter;
        setUploads((prev) => [
          ...prev,
          { id, name: file.name, size: file.size, percent: 0, status: "uploading" },
        ]);
        uploadQueue.current = uploadQueue.current.then(() => runUpload(id, file, targetFolderId));
      }
    },
    [runUpload],
  );

  const dismissUpload = useCallback((id: number) => {
    setUploads((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const clearFinishedUploads = useCallback(() => {
    setUploads((prev) => prev.filter((entry) => entry.status === "uploading"));
  }, []);

  const handleFileInputChange = () => {
    const input = fileInputRef.current;
    if (input === null) return;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length > 0) enqueueUploads(files, folderId);
  };

  const handleDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) enqueueUploads(files, folderId);
  };

  // ── Navigation and actions ────────────────────────────────────────────────
  const navigateToFolder = useCallback(
    (targetFolderId: string | null) => {
      setSearchInput("");
      if (targetFolderId === null) {
        setSearchParams({}, { replace: false });
      } else {
        setSearchParams({ folder: targetFolderId }, { replace: false });
      }
    },
    [setSearchParams],
  );

  const handleFolderAction = useCallback((action: FolderAction, folder: FolderDTO) => {
    if (action === "rename") {
      setRenaming({ kind: "folder", id: folder.id, name: folder.name });
    } else if (action === "move") {
      setMoving({ kind: "folder", folder });
    } else {
      setDeletingFolder(folder);
    }
  }, []);

  const handleFileAction = useCallback((action: FileAction, file: FileDTO) => {
    if (action === "rename") {
      setRenaming({ kind: "file", id: file.id, name: file.name });
    } else if (action === "move") {
      setMoving({ kind: "file", file });
    } else if (action === "download") {
      api.files.download(file.id);
    } else {
      setDeletingFile(file);
    }
  }, []);

  // ── Error handling: storage init fallback and deleted-folder recovery ────
  const storageNotInitialized =
    (content.folders.error instanceof ApiError &&
      content.folders.error.code === ERROR_CODES.STORAGE_NOT_INITIALIZED) ||
    (content.files.error instanceof ApiError &&
      content.files.error.code === ERROR_CODES.STORAGE_NOT_INITIALIZED);

  useEffect(() => {
    if (folderId === null) return;
    const notFound =
      (content.folders.error instanceof ApiError &&
        content.folders.error.code === ERROR_CODES.NOT_FOUND) ||
      (content.files.error instanceof ApiError &&
        content.files.error.code === ERROR_CODES.NOT_FOUND);
    if (notFound) setSearchParams({}, { replace: true });
  }, [folderId, content.folders.error, content.files.error, setSearchParams]);

  if (storage === null || storageNotInitialized) {
    return <StorageInit />;
  }

  // ── Derived view data (storage is guaranteed to exist here) ──────────────
  const user = me.data?.user ?? null;
  const displayName = user !== null ? (user.firstName ?? user.username ?? "Account") : "Account";
  const initial = displayName.charAt(0).toUpperCase() || "?";
  const username = user?.username ?? null;

  const folders = content.folders.data?.folders ?? [];
  const files = content.files.data?.files ?? [];
  const contentError = content.folders.error ?? content.files.error;
  const contentLoading = content.folders.isPending || content.files.isPending;
  const showingPlaceholder = content.folders.isPlaceholderData || content.files.isPlaceholderData;

  const resultFolders = searchResults.data?.folders ?? [];
  const resultFiles = searchResults.data?.files ?? [];
  const searchActive = searchQuery !== "";
  const onRootView = folderId === null && !searchActive;

  const retryContent = () => {
    void content.folders.refetch();
    void content.files.refetch();
  };

  const errorBox = (message: string, onRetry: () => void) => (
    <div className="oc-card mt-6 p-6 text-center">
      <p className="text-sm font-medium text-gray-900">Something went wrong.</p>
      <p className="mt-1 text-sm text-gray-500">{message}</p>
      <button type="button" className="oc-btn-secondary mt-4" onClick={onRetry}>
        Try again
      </button>
    </div>
  );

  const toolbar = (
    <div className="flex gap-2">
      <button type="button" className="oc-btn-secondary" onClick={() => setCreateFolderOpen(true)}>
        <NewFolderIcon className="h-4 w-4" />
        New folder
      </button>
      <button
        type="button"
        className="oc-btn-primary"
        onClick={() => fileInputRef.current?.click()}
      >
        <UploadIcon className="h-4 w-4" />
        Upload files
      </button>
    </div>
  );

  const emptyState = (
    <div className="mt-16 flex flex-col items-center text-center">
      <div className="rounded-full bg-indigo-50 p-4">
        <CloudIcon className="h-8 w-8 text-indigo-500" />
      </div>
      <h2 className="mt-4 text-base font-semibold text-gray-900">Nothing here yet</h2>
      <p className="mt-1 text-sm text-gray-500">
        Upload your first file or create a folder to get started.
      </p>
    </div>
  );

  return (
    <div className="flex h-dvh bg-gray-50">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-gray-200 bg-white md:flex">
        <div className="flex items-center gap-2 px-4 py-4">
          <CloudIcon className="h-6 w-6 text-indigo-600" />
          <span className="text-lg font-semibold tracking-tight text-gray-900">OmniCloud</span>
        </div>
        <nav aria-label="Main" className="px-3">
          <button
            type="button"
            onClick={() => navigateToFolder(null)}
            aria-current={onRootView ? "page" : undefined}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none ${
              onRootView ? "bg-indigo-50 text-indigo-700" : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            <FolderIcon className="h-4 w-4" />
            My Drive
          </button>
        </nav>
        <div className="mt-auto p-3">
          <div className="oc-card p-3">
            <div className="flex items-center gap-2">
              <CloudIcon className="h-4 w-4 shrink-0 text-indigo-600" />
              <span
                className="min-w-0 truncate text-sm font-medium text-gray-900"
                title={storage.title}
              >
                {storage.title}
              </span>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium uppercase tracking-wide text-gray-600">
                {storage.provider}
              </span>
            </p>
            <p className="mt-1.5 text-xs text-gray-400">Connected via Telegram</p>
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-gray-200 p-3">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-medium text-white"
          >
            {initial}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gray-900">{displayName}</p>
            {username !== null && username !== "" ? (
              <p className="truncate text-xs text-gray-500">@{username}</p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Sign out"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none disabled:opacity-60"
          >
            <LogoutIcon className="h-4 w-4" />
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 md:px-6">
          <div className="flex shrink-0 items-center gap-2 md:hidden">
            <CloudIcon className="h-5 w-5 text-indigo-600" />
            <span className="text-base font-semibold tracking-tight text-gray-900">OmniCloud</span>
          </div>
          <div className="relative w-full max-w-xl flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              aria-label="Search files and folders"
              placeholder="Search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              className="oc-input rounded-full pl-9"
            />
          </div>
          <button
            type="button"
            aria-label="Sign out"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            className="shrink-0 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none disabled:opacity-60 md:hidden"
          >
            <LogoutIcon className="h-4 w-4" />
          </button>
        </header>

        <main
          className="relative flex-1 overflow-y-auto"
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
            {searchActive ? (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h1 className="min-w-0 truncate text-base font-semibold text-gray-900">
                    Results for “{searchQuery}”
                  </h1>
                  <button
                    type="button"
                    className="oc-btn-secondary"
                    onClick={() => setSearchInput("")}
                  >
                    <XIcon className="h-4 w-4" />
                    Clear
                  </button>
                </div>
                {searchResults.isPending ? (
                  <div className="mt-10 flex justify-center">
                    <Spinner className="h-6 w-6 text-indigo-600" />
                  </div>
                ) : searchResults.error !== null ? (
                  errorBox(
                    errorMessage(searchResults.error, "The search failed."),
                    () => void searchResults.refetch(),
                  )
                ) : (
                  <>
                    {resultFolders.length > 0 ? (
                      <section className="mt-6">
                        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                          Folders
                        </h2>
                        <div className="mt-2">
                          <FolderList
                            folders={resultFolders}
                            onOpen={(folder) => navigateToFolder(folder.id)}
                            onAction={handleFolderAction}
                          />
                        </div>
                      </section>
                    ) : null}
                    {resultFiles.length > 0 ? (
                      <section className="mt-6">
                        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                          Files
                        </h2>
                        <div className="mt-2">
                          <FileList files={resultFiles} onAction={handleFileAction} />
                        </div>
                      </section>
                    ) : null}
                    {resultFolders.length === 0 && resultFiles.length === 0 ? (
                      <p className="mt-10 text-center text-sm text-gray-500">
                        No matches for “{searchQuery}”.
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Breadcrumbs path={breadcrumbs} onNavigate={navigateToFolder} />
                  {toolbar}
                </div>

                {contentLoading ? (
                  <div className="mt-10 flex justify-center">
                    <Spinner className="h-6 w-6 text-indigo-600" />
                  </div>
                ) : contentError !== null ? (
                  errorBox(errorMessage(contentError, "Could not load this folder."), retryContent)
                ) : (
                  <div
                    className={`transition-opacity ${showingPlaceholder ? "opacity-60" : "opacity-100"}`}
                  >
                    {folders.length > 0 ? (
                      <section className="mt-6">
                        <h2 className="sr-only">Folders</h2>
                        <FolderList
                          folders={folders}
                          onOpen={(folder) => navigateToFolder(folder.id)}
                          onAction={handleFolderAction}
                        />
                      </section>
                    ) : null}
                    {files.length > 0 ? (
                      <section className="mt-4">
                        <h2 className="sr-only">Files</h2>
                        <FileList files={files} onAction={handleFileAction} />
                      </section>
                    ) : null}
                    {folders.length === 0 && files.length === 0 ? emptyState : null}
                  </div>
                )}
              </>
            )}
          </div>

          {dragging ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-indigo-50/90"
            >
              <div className="rounded-xl border-2 border-dashed border-indigo-400 px-8 py-6 text-sm font-medium text-indigo-700">
                Drop files to upload
              </div>
            </div>
          ) : null}
        </main>
      </div>

      {/* Hidden input backing the "Upload files" button */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
        aria-hidden="true"
        tabIndex={-1}
      />

      <UploadsPanel
        uploads={uploads}
        onDismiss={dismissUpload}
        onClearFinished={clearFinishedUploads}
      />

      {/* Dialogs */}
      {createFolderOpen ? (
        <NameDialog
          title="Create folder"
          label="Folder name"
          confirmLabel="Create"
          initialValue=""
          pending={createFolderMutation.isPending}
          onSubmit={(name) => createFolderMutation.mutate(name)}
          onClose={() => setCreateFolderOpen(false)}
        />
      ) : null}
      {renaming !== null ? (
        <NameDialog
          title={renaming.kind === "file" ? "Rename file" : "Rename folder"}
          label="Name"
          confirmLabel="Rename"
          initialValue={renaming.name}
          pending={renameMutation.isPending}
          onSubmit={(name) => renameMutation.mutate({ ...renaming, name })}
          onClose={() => setRenaming(null)}
        />
      ) : null}
      {moving !== null ? <MoveDialog target={moving} onClose={() => setMoving(null)} /> : null}
      {deletingFile !== null ? (
        <ConfirmDialog
          title={`Delete "${deletingFile.name}"?`}
          message={`This will permanently delete "${deletingFile.name}". This action cannot be undone.`}
          confirmLabel="Delete"
          destructive
          busy={deleteFileMutation.isPending}
          onConfirm={() => deleteFileMutation.mutate(deletingFile)}
          onClose={() => setDeletingFile(null)}
        />
      ) : null}
      {deletingFolder !== null ? (
        <DeleteFolderDialog
          folder={deletingFolder}
          tree={tree}
          onClose={() => setDeletingFolder(null)}
        />
      ) : null}
    </div>
  );
}
