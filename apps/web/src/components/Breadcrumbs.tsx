import type { FolderDTO } from "@omnicloud/shared";
import { ChevronRightIcon } from "./icons";

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
            className={`rounded px-1.5 py-1 font-medium focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none ${
              path.length === 0
                ? "text-gray-900"
                : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
            }`}
          >
            My Drive
          </button>
        </li>
        {path.map((folder, index) => {
          const isLast = index === path.length - 1;
          return (
            <li key={folder.id} className="flex min-w-0 items-center gap-0.5">
              <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
              <button
                type="button"
                onClick={() => onNavigate(folder.id)}
                aria-current={isLast ? "page" : undefined}
                title={folder.name}
                className={`max-w-[14rem] truncate rounded px-1.5 py-1 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none ${
                  isLast
                    ? "font-semibold text-gray-900"
                    : "font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900"
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
