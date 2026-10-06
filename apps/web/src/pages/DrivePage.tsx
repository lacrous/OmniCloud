import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Cloud,
  Folder,
  FolderPlus,
  HardDrive,
  Loader2,
  LogOut,
  Search,
  Upload,
  X,
} from "lucide-react";
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
import { ThemeToggle } from "../components/ThemeToggle";
import { useToast } from "../components/Toasts";
import { UploadsPanel } from "../components/UploadsPanel";
import type { UploadItem } from "../components/UploadsPanel";
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

  // ── Account menu ──────────────────────────────────────────────────────────
  const [accountOpen, setAccountOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  const closeAccount = useCallback(() => setAccountOpen(false), []);

  // A pointer-down outside the wrapper closes the menu (touch has no hover);
  // Escape closes it too.
  useEffect(() => {
    if (!accountOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest?.("[data-account-menu]")) setAccountOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [accountOpen]);

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
    <div className="card mt-6 p-6 text-center">
      <p className="text-sm font-medium">Something went wrong.</p>
      <p className="muted mt-1 text-sm">{message}</p>
      <button type="button" className="btn-secondary mt-4" onClick={onRetry}>
        Try again
      </button>
    </div>
  );

  const emptyState = (
    <div className="mt-16 flex flex-col items-center text-center">
      <span className="grid h-16 w-16 place-items-center rounded-full border border-gold/50 bg-gold-soft">
        <Cloud className="h-7 w-7 text-gold" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-base font-semibold">Nothing here yet</h2>
      <p className="muted mt-1 text-sm">
        Upload your first file or create a folder to get started.
      </p>
    </div>
  );

  const menuShift = reduceMotion ? 0 : -6;

  return (
    <div className="flex h-dvh">
      <a href="#main" className="skip-link btn-gold">
        Skip to content
      </a>

      {/* Sidebar (desktop) */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-bg-soft md:flex">
        <nav aria-label="Main" className="px-3 py-4">
          <button
            type="button"
            onClick={() => navigateToFolder(null)}
            aria-current={onRootView ? "page" : undefined}
            className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
              onRootView
                ? "bg-surface font-medium text-gold-text"
                : "muted hover:bg-surface hover:text-gold-text"
            }`}
          >
            <Folder className="h-4 w-4" aria-hidden="true" />
            My Drive
          </button>
        </nav>
        <div className="mt-auto p-3">
          <div className="rounded-2xl border border-line bg-surface p-4">
            <div className="flex items-center gap-2.5">
              <Cloud className="h-5 w-5 shrink-0 text-gold" aria-hidden="true" />
              <span className="min-w-0 truncate text-sm font-medium" title={storage.title}>
                {storage.title}
              </span>
            </div>
            <p className="muted mt-2 text-[12px]">Connected via Telegram</p>
            <p className="muted mt-0.5 font-mono text-[11px] uppercase tracking-wide">
              {storage.provider}
            </p>
            <div className="hairline mt-3" />
            {username !== null && username !== "" ? (
              <p className="muted mt-2.5 truncate font-mono text-[11px] select-all">@{username}</p>
            ) : null}
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="nav-blur sticky top-0 z-50 flex h-14 shrink-0 items-center gap-3 border-b border-line/70 px-4 md:px-6">
          <a
            href="/"
            className="flex shrink-0 items-center gap-2.5 text-[15px] font-semibold tracking-tight"
          >
            <span className="text-lg leading-none text-gold">◈</span>
            <span>
              Omni<span className="muted font-normal">Cloud</span>
            </span>
          </a>

          <div className="relative ml-2 min-w-0 max-w-md flex-1">
            <Search
              className="muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Search files and folders"
              placeholder="Search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              className="input h-9 rounded-full py-0 pl-9"
            />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2.5">
            <button
              type="button"
              className="btn-gold hidden px-3.5 py-2 text-[13px] sm:inline-flex"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              Upload
            </button>
            <ThemeToggle />
            <div className="relative" data-account-menu>
              <button
                type="button"
                aria-label="Account"
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                onClick={() => setAccountOpen((open) => !open)}
                className="muted flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface text-sm font-semibold transition-colors hover:border-gold hover:text-gold-text"
              >
                {initial}
              </button>

              <AnimatePresence>
                {accountOpen ? (
                  <motion.div
                    key="account-menu"
                    initial={{ opacity: 0, y: menuShift }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: menuShift }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="menu-panel absolute top-full right-0 z-50 mt-2 w-60"
                  >
                    <div className="border-b border-line/70 px-3 py-2.5">
                      <p className="truncate text-[13px] font-semibold">{displayName}</p>
                      <p className="muted truncate text-[12px]">
                        {username !== null && username !== "" ? `@${username}` : "Telegram account"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5 px-3 py-2">
                      <HardDrive className="h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span
                          className="block truncate text-[13px] font-medium"
                          title={storage.title}
                        >
                          {storage.title}
                        </span>
                        <span className="muted block truncate text-[11px] uppercase tracking-wide">
                          {storage.provider}
                        </span>
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        closeAccount();
                        logoutMutation.mutate();
                      }}
                      disabled={logoutMutation.isPending}
                      className="menu-item menu-item-danger"
                    >
                      <LogOut className="h-4 w-4" aria-hidden="true" />
                      {logoutMutation.isPending ? "Signing out…" : "Sign out"}
                    </button>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        </header>

        <main
          className="relative flex-1 overflow-y-auto"
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <div id="main" className="mx-auto max-w-5xl px-4 py-6 md:px-8">
            {searchActive ? (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h1 className="min-w-0 truncate text-lg font-semibold tracking-[-0.01em]">
                    Results for “{searchQuery}”
                  </h1>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setSearchInput("")}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                    Clear
                  </button>
                </div>
                {searchResults.isPending ? (
                  <div className="mt-10 flex justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-gold" aria-hidden="true" />
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
                        <h2 className="eyebrow">Folders</h2>
                        <div className="mt-3">
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
                        <h2 className="eyebrow">Files</h2>
                        <div className="mt-3">
                          <FileList files={resultFiles} onAction={handleFileAction} />
                        </div>
                      </section>
                    ) : null}
                    {resultFolders.length === 0 && resultFiles.length === 0 ? (
                      <p className="muted mt-10 text-center text-sm">
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
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setCreateFolderOpen(true)}
                  >
                    <FolderPlus className="h-4 w-4" aria-hidden="true" />
                    New folder
                  </button>
                  <button
                    type="button"
                    className="btn-gold px-3.5 py-2 text-[13px] sm:hidden"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-4 w-4" aria-hidden="true" />
                    Upload
                  </button>
                  <span className="muted hidden text-[12.5px] md:inline">
                    or drop files anywhere on the page
                  </span>
                </div>

                {contentLoading ? (
                  <div className="mt-10 flex justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-gold" aria-hidden="true" />
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
              className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-bg/70 p-6 backdrop-blur-sm"
            >
              <div className="glass-strong rounded-2xl border-2 border-dashed border-gold/60 px-8 py-6 text-sm font-medium text-gold-text">
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
