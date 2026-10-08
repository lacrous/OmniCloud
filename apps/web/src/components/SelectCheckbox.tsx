import { Check } from "lucide-react";

interface SelectCheckboxProps {
  checked: boolean;
  /** Always visible (true) or only on hover/focus (false). */
  visible: boolean;
  label: string;
  onToggle: (event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void;
}

/**
 * Real checkbox control for drive multi-select. Rendered as a styled button
 * (keeps native semantics via role/aria-checked) so it can carry richer
 * hit-target behaviour on cards and rows.
 */
export function SelectCheckbox({ checked, visible, label, onToggle }: SelectCheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onToggle({ shiftKey: event.shiftKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey });
      }}
      onPointerDown={(event) => event.stopPropagation()}
      className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-all ${
        checked
          ? "border-gold bg-gold text-gold-ink opacity-100"
          : `border-line-strong bg-surface text-transparent hover:border-gold ${
              visible
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            }`
      }`}
    >
      <Check className="h-3 w-3" aria-hidden="true" />
    </button>
  );
}
