import { Loader2 } from "lucide-react";

/** Centered gold spinner used as a section-level loading indicator. */
export function LoadingSpinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="mt-10 flex justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-gold" aria-hidden="true" />
    </div>
  );
}
