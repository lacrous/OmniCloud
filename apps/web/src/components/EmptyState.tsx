import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  children?: ReactNode;
}

/** House empty state: gold-ringed icon, title, muted description, optional CTA. */
export function EmptyState({ icon: Icon, title, description, children }: EmptyStateProps) {
  return (
    <div className="mt-16 flex flex-col items-center px-4 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-full border border-gold/50 bg-gold-soft">
        <Icon className="h-7 w-7 text-gold" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-base font-semibold">{title}</h2>
      {description !== undefined ? (
        <p className="muted mt-1 max-w-sm text-sm">{description}</p>
      ) : null}
      {children !== undefined ? (
        <div className="mt-5 flex flex-wrap justify-center gap-2.5">{children}</div>
      ) : null}
    </div>
  );
}
