import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { MoreIcon } from "./icons";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

interface ItemMenuProps {
  /** Accessible name for the trigger button and the menu. */
  label: string;
  items: MenuItem[];
}

/** Per-item "⋯" dropdown menu. Closes on item selection, Escape, and outside clicks. */
export function ItemMenu({ label, items }: ItemMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target) === false) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const focusMenuItem = (index: number) => {
    const buttons = menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']");
    buttons?.[index]?.focus();
  };

  const moveFocus = (current: HTMLElement, offset: number) => {
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [],
    );
    if (buttons.length === 0) return;
    const index = buttons.indexOf(current as HTMLButtonElement);
    const nextIndex = (index + offset + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (open) {
              focusMenuItem(0);
            } else {
              setOpen(true);
              window.requestAnimationFrame(() => focusMenuItem(0));
            }
          }
        }}
        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none"
      >
        <MoreIcon className="h-4 w-4" />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-sm"
        >
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  moveFocus(event.currentTarget, 1);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  moveFocus(event.currentTarget, -1);
                }
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none ${
                item.danger === true ? "text-red-600" : "text-gray-700"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
