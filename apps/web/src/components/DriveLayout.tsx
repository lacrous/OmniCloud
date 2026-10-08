import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { api, errorMessage } from "../api/client";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { DriveShellContext, useDriveShell } from "../hooks/useDriveShell";
import type { PageShortcuts } from "../hooks/useDriveShell";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useMe } from "../hooks/useMe";
import { useUploads } from "../hooks/useUploads";
import { invalidateDriveQueries, ME_QUERY_KEY, SIGNED_OUT_SESSION } from "../lib/queries";
import type { DriveItem } from "../lib/drive";
import { NameDialog } from "./NameDialog";
import { SearchOverlay } from "./SearchOverlay";
import { ShortcutsHelp } from "./ShortcutsHelp";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { useToast } from "./Toasts";
import { UploadsPanel } from "./UploadsPanel";

/** Authenticated app shell: sidebar, topbar, search overlay and uploads panel. */
export default function DriveLayout() {
  const me = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const uploads = useUploads();
  const reduceMotion = useReducedMotion();

  const storage = me.data?.storage ?? null;
  const health = me.data?.health ?? null;

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const query = debouncedSearch.trim();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [pageShortcuts, setPageShortcuts] = useState<PageShortcuts | null>(null);
  const pageShortcutsRef = useRef<PageShortcuts | null>(null);
  pageShortcutsRef.current = pageShortcuts;

  const createFolderMutation = useMutation({
    mutationFn: (name: string) => api.folders.create(name, activeFolderId),
    onSuccess: (result) => {
      invalidateDriveQueries(queryClient);
      setCreateFolderOpen(false);
      toast.success(`Created "${result.folder.name}"`);
    },
    onError: (error) => toast.error(errorMessage(error, "Could not create folder")),
  });

  const logoutMutation = useMutation({
    mutationFn: api.auth.logout,
    onSuccess: () => {
      queryClient.setQueryData(ME_QUERY_KEY, SIGNED_OUT_SESSION);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "me" });
    },
    onError: (error) => toast.error(errorMessage(error, "Could not sign out")),
  });

  const focusSearch = useCallback(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, []);

  const clearSearch = useCallback(() => setSearchInput(""), []);

  useKeyboardShortcuts(
    {
      onSearch: focusSearch,
      onDelete: () => pageShortcutsRef.current?.onDelete?.(),
      onEnter: () => pageShortcutsRef.current?.onEnter?.(),
      onSelectAll: () => pageShortcutsRef.current?.onSelectAll?.(),
      onEscape: () => {
        pageShortcutsRef.current?.onEscape?.();
        if (helpOpen) setHelpOpen(false);
        else if (sidebarOpen) setSidebarOpen(false);
        else if (query !== "") setSearchInput("");
      },
      onHelp: () => setHelpOpen((open) => !open),
    },
    true,
  );

  useEffect(() => {
    if (!sidebarOpen) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [sidebarOpen]);

  const user = me.data?.user ?? null;
  const displayName = user !== null ? (user.firstName ?? user.username ?? "Account") : "Account";
  const username = user?.username ?? null;

  const shellValue = {
    uploads,
    activeFolderId,
    setActiveFolderId,
    openCreateFolder: () => setCreateFolderOpen(true),
    clearSearch,
    openShortcuts: () => setHelpOpen(true),
    searchInputRef,
    registerPageShortcuts: setPageShortcuts,
  };

  const openFolderFromSearch = (folderId: string) => {
    setSearchInput("");
    navigate(`/?folder=${encodeURIComponent(folderId)}`);
  };

  const handleSearchFile = (item: DriveItem) => {
    if (item.file !== null) api.files.download(item.file.id);
    clearSearch();
  };

  const drawerShift = reduceMotion ? 0 : -20;

  return (
    <DriveShellContext.Provider value={shellValue}>
      <div className="flex h-dvh">
        <a href="#main" className="skip-link btn-gold">
          Skip to content
        </a>

        {/* Sidebar (desktop) */}
        <aside className="hidden w-60 shrink-0 border-r border-line md:block">
          <Sidebar
            storage={storage}
            health={health}
            username={username}
            onCreateFolder={() => setCreateFolderOpen(true)}
          />
        </aside>

        {/* Sidebar (mobile drawer) */}
        <AnimatePresence>
          {sidebarOpen ? (
            <div className="fixed inset-0 z-[80] md:hidden">
              <motion.div
                className="absolute inset-0 bg-black/50"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setSidebarOpen(false)}
                aria-hidden="true"
              />
              <motion.div
                initial={{ x: drawerShift, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: drawerShift, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="absolute top-0 bottom-0 left-0 w-64 border-r border-line"
              >
                <Sidebar
                  storage={storage}
                  health={health}
                  username={username}
                  onCreateFolder={() => {
                    setSidebarOpen(false);
                    setCreateFolderOpen(true);
                  }}
                  onClose={() => setSidebarOpen(false)}
                />
              </motion.div>
            </div>
          ) : null}
        </AnimatePresence>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            storage={storage}
            displayName={displayName}
            username={username}
            search={{ value: searchInput, onChange: setSearchInput, inputRef: searchInputRef }}
            onUpload={() => uploads.openPicker(activeFolderId)}
            onToggleSidebar={() => setSidebarOpen(true)}
            onOpenHelp={() => setHelpOpen(true)}
            onSignOut={() => logoutMutation.mutate()}
            signingOut={logoutMutation.isPending}
          />
          <main id="main" className="relative flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>

        <input
          ref={uploads.pickerInputRef}
          type="file"
          multiple
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={uploads.onPickerChange}
        />

        <UploadsPanel
          uploads={uploads.uploads}
          onCancel={uploads.cancel}
          onRetry={uploads.retry}
          onDismiss={uploads.dismiss}
          onClearFinished={uploads.clearFinished}
        />

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

        {helpOpen ? <ShortcutsHelp onClose={() => setHelpOpen(false)} /> : null}

        {query !== "" ? (
          <SearchOverlay
            query={query}
            onClose={clearSearch}
            onOpenFolder={(folder) => openFolderFromSearch(folder.id)}
            onOpenFile={handleSearchFile}
          />
        ) : null}
      </div>
    </DriveShellContext.Provider>
  );
}

export { useDriveShell };
