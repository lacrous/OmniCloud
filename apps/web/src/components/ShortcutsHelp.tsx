import { Modal } from "./Modal";

interface ShortcutsHelpProps {
  onClose: () => void;
}

const SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: "Ctrl/⌘ K", label: "Focus search" },
  { keys: "Enter", label: "Open the focused item" },
  { keys: "Delete", label: "Move selection to Trash" },
  { keys: "Ctrl/⌘ A", label: "Select all visible items" },
  { keys: "Esc", label: "Clear selection / close panels" },
  { keys: "Shift-click", label: "Select a range of items" },
  { keys: "Ctrl/⌘-click", label: "Add or remove one item" },
  { keys: "Click the ⋯", label: "Item actions menu" },
  { keys: "Right-click", label: "Context menu" },
  { keys: "?", label: "Show this help" },
];

/** "?" popover documenting the drive-wide keyboard shortcuts. */
export function ShortcutsHelp({ onClose }: ShortcutsHelpProps) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <dl className="grid gap-2">
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.keys} className="flex items-center justify-between gap-4">
            <dt className="muted text-[13px]">{shortcut.label}</dt>
            <dd>
              <kbd className="rounded-md border border-line-strong bg-surface px-2 py-1 font-mono text-[12px]">
                {shortcut.keys}
              </kbd>
            </dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
