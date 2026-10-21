import { ArrowUpCircle } from "lucide-react";
import type { UpdateCheckDTO } from "@omnicloud/shared";

interface UpdateNoticeProps {
  result: UpdateCheckDTO | undefined;
}

/**
 * "A newer release is available" notice, shown under the app title in the
 * sidebar.
 *
 * Only the `update_available` state renders anything: an unpublished package
 * or a failed registry lookup is not news, and showing them would train people
 * to ignore the badge.
 */
export function UpdateNotice({ result }: UpdateNoticeProps) {
  if (result === undefined || result.status !== "update_available") return null;
  if (result.latestVersion === null) return null;
  // The package name is operator-configurable, so the link follows it rather
  // than assuming the default.
  const packagePath = result.packageName.replace("/", "%2f");

  return (
    <a
      href={`https://www.npmjs.com/package/${packagePath}`}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-3 flex items-start gap-2 rounded-xl border border-gold/30 bg-gold-soft px-2.5 py-2 text-left transition-colors hover:border-gold/50"
      title={`Version ${result.latestVersion} is available`}
    >
      <ArrowUpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold-text" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-[11.5px] leading-tight font-semibold text-gold-text">
          Update available
        </span>
        <span className="muted block text-[11px] leading-tight">
          v{result.latestVersion} · you have v{result.currentVersion}
        </span>
      </span>
    </a>
  );
}
