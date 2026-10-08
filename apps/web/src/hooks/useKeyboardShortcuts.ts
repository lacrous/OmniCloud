import { useEffect, useRef } from "react";

export interface ShortcutHandlers {
  /** Ctrl/Cmd+K — focus the search field. */
  onSearch: () => void;
  /** Delete/Backspace — move the current selection to trash. */
  onDelete: () => void;
  /** Enter — open the focused item. */
  onEnter: () => void;
  /** Escape — clear selection / close panels. */
  onEscape: () => void;
  /** Ctrl/Cmd+A — select every visible item. */
  onSelectAll: () => void;
  /** "?" — toggle the shortcuts help popover. */
  onHelp: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * Registers the drive-wide keyboard shortcuts documented in the "?" popover.
 * Shortcuts are ignored while typing (except Escape and Ctrl/Cmd combos), and
 * disabled entirely while a dialog/overlay is open.
 *
 * The handlers object is read through a ref, so callers may pass inline arrow
 * functions without re-registering the global listener on every render.
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers, enabled = true): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      const typing = isTypingTarget(event.target);
      const current = ref.current;

      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        current.onSearch();
        return;
      }
      if (mod && event.key.toLowerCase() === "a") {
        if (typing) return;
        event.preventDefault();
        current.onSelectAll();
        return;
      }
      if (event.key === "Escape") {
        current.onEscape();
        return;
      }
      if (typing) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        current.onDelete();
        return;
      }
      if (event.key === "Enter") {
        current.onEnter();
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        current.onHelp();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
