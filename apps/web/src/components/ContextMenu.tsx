import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import type { MenuItem } from "./ItemMenu";

export interface ContextMenuState {
  x: number;
  y: number;
  label: string;
  items: MenuItem[];
}

interface ContextMenuProps {
  menu: ContextMenuState | null;
  onClose: () => void;
}

/**
 * Right-click context menu in the house menu style, positioned at the cursor
 * and clamped to the viewport. Escape, outside pointer-down, scroll and resize
 * all close it.
 */
export function ContextMenu({ menu, onClose }: ContextMenuProps) {
  const reduceMotion = useReducedMotion();
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (menu === null) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target) === false) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [menu, onClose]);

  const shift = reduceMotion ? 0 : -4;
  const width = 224;
  const style =
    menu === null
      ? undefined
      : {
          left: Math.min(menu.x, Math.max(0, window.innerWidth - width - 8)),
          top: Math.min(menu.y, Math.max(0, window.innerHeight - 240)),
        };

  return (
    <AnimatePresence>
      {menu !== null ? (
        <motion.div
          ref={menuRef}
          role="menu"
          aria-label={menu.label}
          initial={{ opacity: 0, y: shift }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: shift }}
          transition={{ duration: 0.13, ease: "easeOut" }}
          style={style}
          className="menu-panel fixed z-[120] w-56"
        >
          {menu.items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              type="button"
              disabled={item.disabled === true}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
              className={`menu-item text-left ${item.danger === true ? "menu-item-danger" : ""}`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
