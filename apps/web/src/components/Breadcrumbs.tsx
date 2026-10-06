import { ChevronRight } from "lucide-react";
import type { FolderDTO } from "@omnicloud/shared";

interface BreadcrumbsProps {
  /** Path from the root to the current folder (excluding the virtual "My Drive" crumb). */
  path: FolderDTO[];
  onNavigate: (folderId: string | null) => void;
}

export function Breadcrumbs({ path, onNavigate }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-0.5 text-sm">
        <li className="shrink-0">
          <button
            type="button"
            onClick={() => onNavigate(null)}
            aria-current={path.length === 0 ? "page" : undefined}
            className={`rounded px-1.5 py-1 transition-colors ${
              path.length === 0 ? "font-medium text-gold-text" : "muted hover:text-gold-text"
            }`}
          >
            My Drive
          </button>
        </li>
        {path.map((folder, index) => {
          const isLast = index === path.length - 1;
          return (
            <li key={folder.id} className="flex min-w-0 items-center gap-0.5">
              <ChevronRight className="muted h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <button
                type="button"
                onClick={() => onNavigate(folder.id)}
                aria-current={isLast ? "page" : undefined}
                title={folder.name}
                className={`max-w-[14rem] truncate rounded px-1.5 py-1 transition-colors ${
                  isLast ? "font-medium text-gold-text" : "muted hover:text-gold-text"
                }`}
              >
                {folder.name}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
