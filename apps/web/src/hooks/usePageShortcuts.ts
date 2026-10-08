import { useEffect } from "react";
import { useDriveShell } from "./useDriveShell";
import type { PageShortcuts } from "./useDriveShell";

/**
 * Installs the active page's selection shortcuts (Delete/Enter/Ctrl+A/Esc) into
 * the drive layout. Handlers are read through the latest render, so inline
 * closures stay fresh without re-registering.
 */
export function usePageShortcuts(handlers: PageShortcuts, enabled = true): void {
  const { registerPageShortcuts } = useDriveShell();

  useEffect(() => {
    if (!enabled) {
      registerPageShortcuts(null);
      return;
    }
    registerPageShortcuts(handlers);
    return () => registerPageShortcuts(null);
  });
}
