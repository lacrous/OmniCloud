import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import type { FormEvent } from "react";
import { Modal } from "./Modal";

interface NameDialogProps {
  title: string;
  label: string;
  confirmLabel: string;
  initialValue: string;
  pending: boolean;
  onSubmit: (name: string) => void;
  onClose: () => void;
}

/** Text-input dialog used for both "create folder" and "rename". */
export function NameDialog({
  title,
  label,
  confirmLabel,
  initialValue,
  pending,
  onSubmit,
  onClose,
}: NameDialogProps) {
  const [name, setName] = useState(initialValue);
  const inputId = useId();

  const trimmed = name.trim();
  const unchanged = trimmed === initialValue.trim();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || trimmed === "" || unchanged) return;
    onSubmit(trimmed);
  };

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate>
        <label htmlFor={inputId} className="grid gap-1.5">
          <span className="text-[13px] font-medium">{label}</span>
          <input
            id={inputId}
            type="text"
            autoFocus
            value={name}
            maxLength={255}
            disabled={pending}
            onFocus={(event) => event.target.select()}
            onChange={(event) => setName(event.target.value)}
            className="input"
          />
        </label>
        <div className="mt-5 flex justify-end gap-2.5">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn-gold"
            disabled={pending || trimmed === "" || unchanged}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {pending ? "Saving…" : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
