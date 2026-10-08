import { Cloud, FolderPlus, HardDrive, X } from "lucide-react";
import { NavLink } from "react-router-dom";
import type { StorageHealthDTO } from "@omnicloud/shared";
import type { StorageDTO } from "@omnicloud/shared";
import { healthVisual } from "../lib/health";
import { SECTIONS } from "../lib/sections";

interface SidebarProps {
  storage: StorageDTO | null;
  health: StorageHealthDTO | null;
  username: string | null;
  onCreateFolder: () => void;
  /** Rendered inside a mobile drawer; shows a close button. */
  onClose?: () => void;
}

function StateDot({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 shrink-0 rounded-full bg-current ${tone}`} aria-hidden="true" />
      <span className={`text-[11px] font-medium ${tone}`}>{label}</span>
    </span>
  );
}

/** Left navigation: sections, a "New folder" action and the storage card. */
export function Sidebar({ storage, health, username, onCreateFolder, onClose }: SidebarProps) {
  const state = healthVisual(health);

  return (
    <div className="flex h-full flex-col bg-bg-soft">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <span className="eyebrow">Drive</span>
        {onClose !== undefined ? (
          <button
            type="button"
            aria-label="Close navigation"
            onClick={onClose}
            className="muted grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-surface hover:text-gold-text md:hidden"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <nav aria-label="Main" className="px-3">
        <ul className="grid gap-0.5">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <li key={section.id}>
                <NavLink
                  to={section.path}
                  end={section.path === "/"}
                  onClick={() => onClose?.()}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                      isActive
                        ? "bg-surface font-medium text-gold-text"
                        : "muted hover:bg-surface hover:text-gold-text"
                    }`
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {section.label}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="px-3 pt-3">
        <button
          type="button"
          className="btn-secondary w-full justify-center"
          onClick={onCreateFolder}
        >
          <FolderPlus className="h-4 w-4" aria-hidden="true" />
          New folder
        </button>
      </div>

      <div className="mt-auto p-3">
        <div className="rounded-2xl border border-line bg-surface p-4">
          <div className="flex items-center gap-2.5">
            <Cloud className="h-5 w-5 shrink-0 text-gold" aria-hidden="true" />
            <span
              className="min-w-0 truncate text-sm font-medium"
              title={storage?.title ?? undefined}
            >
              {storage?.title ?? "No storage"}
            </span>
          </div>
          <div className="mt-2">
            {health !== null ? (
              <StateDot tone={state.tone} label={state.label} />
            ) : (
              <span className="muted text-[11px]">Status unknown</span>
            )}
          </div>
          {state.hint !== null ? (
            <p className={`mt-1.5 text-[11px] leading-snug ${state.tone}`}>{state.hint}</p>
          ) : null}
          <p className="muted mt-2 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide">
            <HardDrive className="h-3 w-3" aria-hidden="true" />
            {storage?.provider ?? "—"}
          </p>
          <div className="hairline mt-3" />
          {username !== null && username !== "" ? (
            <p className="muted mt-2.5 truncate font-mono text-[11px] select-all">@{username}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
