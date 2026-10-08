import type { ReactNode } from "react";

interface PageHeaderProps {
  title: ReactNode;
  /** Optional element to the right of the title row (e.g. an action). */
  actions?: ReactNode;
  children?: ReactNode;
}

/** Page title row used at the top of every drive section. */
export function PageHeader({ title, actions, children }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">{title}</div>
      {actions !== undefined ? (
        <div className="flex flex-wrap items-center gap-2.5">{actions}</div>
      ) : null}
      {children !== undefined ? <div className="w-full">{children}</div> : null}
    </div>
  );
}

/** Standard section heading. */
export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="min-w-0 truncate text-lg font-semibold tracking-[-0.01em]">{children}</h1>;
}
