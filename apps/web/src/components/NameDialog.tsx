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
        <label htmlFor={inputId} className="block text-sm font-medium text-gray-700">
          {label}
        </label>
        <input
          id={inputId}
          type="text"
          autoFocus
          value={name}
          maxLength={255}
          disabled={pending}
          onFocus={(event) => event.target.select()}
          onChange={(event) => setName(event.target.value)}
          className="oc-input mt-1.5"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="oc-btn-secondary" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button
            type="submit"
            className="oc-btn-primary"
            disabled={pending || trimmed === "" || unchanged}
          >
            {pending ? "Saving…" : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
