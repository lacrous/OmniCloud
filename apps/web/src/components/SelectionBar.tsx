import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckCheck, X } from "lucide-react";
import type { ReactNode } from "react";

interface SelectionBarProps {
  count: number;
  onClear: () => void;
  onSelectAll?: () => void;
  children?: ReactNode;
}

/**
 * Floating action bar shown while one or more drive items are selected. Actions
 * are supplied by the page so each section (My Drive, Starred, Trash) can offer
 * the right set.
 */
export function SelectionBar({ count, onClear, onSelectAll, children }: SelectionBarProps) {
  const reduceMotion = useReducedMotion();
  const visible = count > 0;

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="selection-bar"
          role="toolbar"
          aria-label={`${count} items selected`}
          initial={{ opacity: 0, y: reduceMotion ? 0 : 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduceMotion ? 0 : 20 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="glass-strong fixed bottom-4 left-1/2 z-[90] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-1.5 rounded-2xl border border-line px-3 py-2"
        >
          <span className="px-2 text-[13px] font-medium tabular-nums">{count} selected</span>
          <span className="text-line-strong" aria-hidden="true">
            ·
          </span>
          {onSelectAll !== undefined ? (
            <button type="button" className="btn-secondary" onClick={onSelectAll}>
              <CheckCheck className="h-4 w-4" aria-hidden="true" />
              Select all
            </button>
          ) : null}
          {children}
          <button
            type="button"
            className="btn-ghost"
            onClick={onClear}
            aria-label="Clear selection"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            Clear
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
