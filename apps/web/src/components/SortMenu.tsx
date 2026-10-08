import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { SortField, SortOrder } from "@omnicloud/shared";

const SORT_LABELS: Record<SortField, string> = {
  name: "Name",
  size: "Size",
  createdAt: "Date created",
  updatedAt: "Last modified",
  type: "Type",
};

interface SortMenuProps {
  sort: SortField;
  order: SortOrder;
  onChange: (sort: SortField, order: SortOrder) => void;
}

/** Toolbar dropdown for picking a sort field and direction. */
export function SortMenu({ sort, order, onChange }: SortMenuProps) {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target) === false) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const fields = Object.keys(SORT_LABELS) as SortField[];
  const menuShift = reduceMotion ? 0 : -6;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="btn-secondary"
      >
        <ArrowUpDown className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">{SORT_LABELS[sort]}</span>
        {order === "asc" ? (
          <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            role="menu"
            aria-label="Sort by"
            initial={{ opacity: 0, y: menuShift }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: menuShift }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="menu-panel absolute top-full right-0 z-30 mt-1.5 w-52"
          >
            {fields.map((field) => (
              <button
                key={field}
                role="menuitemradio"
                aria-checked={sort === field}
                type="button"
                onClick={() => {
                  if (sort === field) onChange(field, order === "asc" ? "desc" : "asc");
                  else onChange(field, "asc");
                }}
                className="menu-item justify-between text-left"
              >
                {SORT_LABELS[field]}
                {sort === field ? (
                  order === "asc" ? (
                    <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                  )
                ) : null}
              </button>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
