import { useEffect, useRef } from "react";
import { useDriveShell } from "./useDriveShell";
import type { PageShortcuts } from "./useDriveShell";

/**
 * Installs the active page's selection shortcuts (Delete/Enter/Ctrl+A/Esc) into
 * the drive layout. Handlers are read through the latest render, so inline
 * closures stay fresh without re-registering.
 */
export function usePageShortcuts(handlers: PageShortcuts, enabled = true): void {
  const { registerPageShortcuts } = useDriveShell();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const registration = enabled
      ? {
          onDelete: () => handlersRef.current.onDelete?.(),
          onEnter: () => handlersRef.current.onEnter?.(),
          onSelectAll: () => handlersRef.current.onSelectAll?.(),
          onEscape: () => handlersRef.current.onEscape?.(),
        }
      : null;
    registerPageShortcuts(registration);
    return () => registerPageShortcuts(null);
  }, [enabled, registerPageShortcuts]);
}
