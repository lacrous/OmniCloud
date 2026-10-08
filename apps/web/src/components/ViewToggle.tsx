import { LayoutGrid, List } from "lucide-react";
import type { ViewMode } from "../lib/drive";

interface ViewToggleProps {
  view: ViewMode;
  onChange: (view: ViewMode) => void;
}

/** Segmented list/grid switch. */
export function ViewToggle({ view, onChange }: ViewToggleProps) {
  const options: Array<{ mode: ViewMode; label: string; Icon: typeof List }> = [
    { mode: "list", label: "List view", Icon: List },
    { mode: "grid", label: "Grid view", Icon: LayoutGrid },
  ];

  return (
    <div
      role="group"
      aria-label="View mode"
      className="inline-flex shrink-0 rounded-lg border border-line-strong bg-surface p-0.5"
    >
      {options.map(({ mode, label, Icon }) => {
        const active = view === mode;
        return (
          <button
            key={mode}
            type="button"
            aria-label={label}
            aria-pressed={active}
            onClick={() => onChange(mode)}
            className={`grid h-7 w-8 place-items-center rounded-md transition-colors ${
              active ? "bg-gold-soft text-gold-text" : "muted hover:text-gold-text"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
