import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, CircleAlert, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

type ToastKind = "success" | "error";

interface ToastEntry {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  success(message: string): void;
  error(message: string): void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const reduceMotion = useReducedMotion();
  const timers = useRef(new Set<number>());
  const nextId = useRef(0);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) window.clearTimeout(timer);
    };
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((prev) => [...prev, { id, kind, message }]);
      const timer = window.setTimeout(() => {
        timers.current.delete(timer);
        dismiss(id);
      }, AUTO_DISMISS_MS);
      timers.current.add(timer);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      success: (message) => push("success", message),
      error: (message) => push("error", message),
    }),
    [push],
  );

  const slide = reduceMotion ? 0 : 16;

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed top-4 right-4 z-[200] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      >
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              role={toast.kind === "error" ? "alert" : "status"}
              initial={{ opacity: 0, x: slide }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: slide }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="glass-strong pointer-events-auto flex items-start gap-2.5 rounded-xl border border-line px-4 py-3 text-[13px]"
            >
              {toast.kind === "error" ? (
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-bad" aria-hidden="true" />
              ) : (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-gold-text" aria-hidden="true" />
              )}
              <p className="min-w-0 flex-1 break-words">{toast.message}</p>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => dismiss(toast.id)}
                className="muted rounded p-0.5 transition-colors hover:bg-bg-soft hover:text-gold-text"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context === null) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
