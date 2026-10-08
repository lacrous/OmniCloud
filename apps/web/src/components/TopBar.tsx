import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { HardDrive, Keyboard, LogOut, Menu, Search, Upload } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import type { RefObject } from "react";
import type { StorageDTO } from "@omnicloud/shared";
import { ThemeToggle } from "./ThemeToggle";

interface TopBarSearch {
  value: string;
  onChange: (value: string) => void;
  inputRef: RefObject<HTMLInputElement>;
}

interface TopBarProps {
  storage: StorageDTO | null;
  displayName: string;
  username: string | null;
  search: TopBarSearch;
  onUpload: () => void;
  onToggleSidebar: () => void;
  onOpenHelp: () => void;
  onSignOut: () => void;
  signingOut: boolean;
}

/** Sticky top chrome: brand, search, upload, theme toggle and account menu. */
export function TopBar({
  storage,
  displayName,
  username,
  search,
  onUpload,
  onToggleSidebar,
  onOpenHelp,
  onSignOut,
  signingOut,
}: TopBarProps) {
  const [accountOpen, setAccountOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const initial = displayName.charAt(0).toUpperCase() || "?";

  const closeAccount = useCallback(() => setAccountOpen(false), []);

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

  const menuShift = reduceMotion ? 0 : -6;
  const searchId = useId();

  return (
    <header className="nav-blur sticky top-0 z-50 flex h-14 shrink-0 items-center gap-3 border-b border-line/70 px-4 md:px-6">
      <button
        type="button"
        aria-label="Open navigation"
        onClick={onToggleSidebar}
        className="muted grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors hover:bg-surface hover:text-gold-text md:hidden"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>

      <a
        href="/"
        className="flex shrink-0 items-center gap-2.5 text-[15px] font-semibold tracking-tight"
      >
        <span className="text-lg leading-none text-gold">◈</span>
        <span className="hidden sm:inline">
          Omni<span className="muted font-normal">Cloud</span>
        </span>
      </a>

      <div className="relative ml-1 min-w-0 max-w-md flex-1">
        <label htmlFor={searchId} className="sr-only">
          Search files and folders
        </label>
        <Search
          className="muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <input
          id={searchId}
          ref={search.inputRef}
          type="search"
          placeholder="Search  (Ctrl/⌘K)"
          value={search.value}
          onChange={(event) => search.onChange(event.target.value)}
          className="input h-9 rounded-full py-0 pl-9"
        />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2.5">
        <button
          type="button"
          onClick={onOpenHelp}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
          className="muted hidden h-9 w-9 place-items-center rounded-full border border-line-strong bg-surface transition-colors hover:border-gold hover:text-gold-text sm:grid"
        >
          <Keyboard className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="btn-gold hidden px-3.5 py-2 text-[13px] sm:inline-flex"
          onClick={onUpload}
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
                      title={storage?.title ?? undefined}
                    >
                      {storage?.title ?? "No storage"}
                    </span>
                    <span className="muted block truncate text-[11px] uppercase tracking-wide">
                      {storage?.provider ?? "—"}
                    </span>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    closeAccount();
                    onSignOut();
                  }}
                  disabled={signingOut}
                  className="menu-item menu-item-danger"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  {signingOut ? "Signing out..." : "Sign out"}
                </button>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
