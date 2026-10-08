import { useCallback, useMemo, useRef, useState } from "react";

/** A reference to a file or folder, used as the unit of selection. */
export interface ItemRef {
  kind: "file" | "folder";
  id: string;
}

/** Stable selection key for a file/folder reference. */
export function itemKey(ref: ItemRef): string {
  return `${ref.kind}:${ref.id}`;
}

interface ToggleOptions {
  /** Ordered keys of every visible item, enabling shift-click range selection. */
  orderedKeys?: string[];
  /** Shift-click semantics (extend from the anchor instead of toggling one). */
  range?: boolean;
}

export interface SelectionController {
  selected: ReadonlySet<string>;
  count: number;
  isSelected: (key: string) => boolean;
  has: (ref: ItemRef) => boolean;
  select: (ref: ItemRef) => void;
  toggle: (ref: ItemRef, options?: ToggleOptions) => void;
  clear: () => void;
  selectAll: (keys: string[]) => void;
  /** Drops keys that are no longer present (call when the visible set changes). */
  prune: (validKeys: string[]) => void;
}

/**
 * Multi-select state for drive lists: single toggle, shift-click ranges and
 * Ctrl/Cmd-click add/remove, anchored on the last clicked item.
 */
export function useSelection(): SelectionController {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>());
  const anchor = useRef<string | null>(null);

  const isSelected = useCallback((key: string) => selected.has(key), [selected]);

  const clear = useCallback(() => {
    setSelected(new Set<string>());
    anchor.current = null;
  }, []);

  const select = useCallback((ref: ItemRef) => {
    const key = itemKey(ref);
    setSelected(new Set<string>([key]));
    anchor.current = key;
  }, []);

  const toggle = useCallback((ref: ItemRef, options: ToggleOptions = {}) => {
    const key = itemKey(ref);
    const { orderedKeys, range } = options;
    if (range === true && anchor.current !== null && orderedKeys !== undefined) {
      const from = orderedKeys.indexOf(anchor.current);
      const to = orderedKeys.indexOf(key);
      if (from !== -1 && to !== -1) {
        const [lo, hi] = from < to ? [from, to] : [to, from];
        setSelected((prev) => {
          const next = new Set(prev);
          for (let index = lo; index <= hi; index += 1) {
            const rangeKey = orderedKeys[index];
            if (rangeKey !== undefined) next.add(rangeKey);
          }
          return next;
        });
        return;
      }
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    anchor.current = key;
  }, []);

  const selectAll = useCallback((keys: string[]) => {
    setSelected(new Set(keys));
    anchor.current = keys[0] ?? null;
  }, []);

  const prune = useCallback((validKeys: string[]) => {
    const valid = new Set(validKeys);
    setSelected((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const key of prev) {
        if (valid.has(key)) next.add(key);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, []);

  const has = useCallback((ref: ItemRef) => selected.has(itemKey(ref)), [selected]);

  return useMemo(
    () => ({
      selected,
      count: selected.size,
      isSelected,
      has,
      select,
      toggle,
      clear,
      selectAll,
      prune,
    }),
    [selected, isSelected, has, select, toggle, clear, selectAll, prune],
  );
}
