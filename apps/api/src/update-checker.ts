import type { UpdateCheckDTO } from "@omnicloud/shared";

/**
 * Periodic "is a newer release available?" check against the npm registry.
 *
 * The check runs server-side on a fixed interval and caches its result, so the
 * web app can poll a local endpoint cheaply and the registry is contacted at
 * most once per interval regardless of how many browsers are open.
 *
 * Nothing here is trusted beyond the version string: the registry is only ever
 * asked for the newest published version, and a failure is reported as
 * `unknown` rather than guessed at.
 */

const REGISTRY_URL = "https://registry.npmjs.org";
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const REQUEST_TIMEOUT_MS = 10_000;

/** Compares two semver strings. Returns >0 when `a` is newer than `b`. */
export function compareVersions(a: string, b: string): number {
  const parse = (version: string): { parts: number[]; prerelease: string } => {
    // Build metadata (1.0.0+build) is ignored for ordering, as semver requires.
    const [withoutBuild = "0"] = version.trim().replace(/^v/, "").split("+");
    const [core = "0", ...rest] = withoutBuild.split("-");
    const parts = core.split(".").map((piece) => {
      const value = Number.parseInt(piece, 10);
      return Number.isFinite(value) ? value : 0;
    });
    return { parts, prerelease: rest.join("-") };
  };

  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.parts.length, right.parts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left.parts[index] ?? 0) - (right.parts[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  // A prerelease sorts before its release: 1.0.0-beta < 1.0.0.
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === "") return 1;
  if (right.prerelease === "") return -1;
  return left.prerelease > right.prerelease ? 1 : -1;
}

export interface UpdateCheckerOptions {
  /** The version currently running. */
  currentVersion: string;
  /** npm package name, e.g. "@hilbras/omnicloud". */
  packageName: string;
  /** Overrides the registry base URL; used by tests. */
  registryUrl?: string;
  /** Overrides the poll interval; used by tests. */
  intervalMs?: number;
  /** Injected fetch, used by tests. */
  fetchImpl?: typeof fetch;
  /** Receives a log line when the check completes or fails. */
  onResult?: (result: UpdateCheckDTO) => void;
}

export interface UpdateChecker {
  /** The most recent result, or null if the check has not completed yet. */
  current(): UpdateCheckDTO | null;
  /** Runs a check immediately and returns its result. */
  check(): Promise<UpdateCheckDTO>;
  /** Stops the periodic timer. */
  stop(): void;
}

function encodePackageName(name: string): string {
  // npm scopes use "/" which must be percent-encoded in the registry path.
  return name.replace("/", "%2f");
}

/**
 * Creates the checker and starts its interval. The first check runs immediately
 * so the UI has data immediately rather than after an hour.
 */
export function startUpdateChecker(options: UpdateCheckerOptions): UpdateChecker {
  const registry = (options.registryUrl ?? REGISTRY_URL).replace(/\/+$/, "");
  const packageName = options.packageName;
  const intervalMs = options.intervalMs ?? CHECK_INTERVAL_MS;
  const doFetch = options.fetchImpl ?? fetch;
  let latest: UpdateCheckDTO | null = null;
  let inFlight: Promise<UpdateCheckDTO> | null = null;

  const check = async (): Promise<UpdateCheckDTO> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await doFetch(`${registry}/${encodePackageName(packageName)}/latest`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        if (response.status === 404) {
          return {
            status: "not_published",
            currentVersion: options.currentVersion,
            latestVersion: null,
            packageName,
            checkedAt: new Date().toISOString(),
            detail: `${packageName} is not published on npm yet.`,
          };
        }
        throw new Error(`registry responded ${response.status}`);
      }
      const body = (await response.json()) as { version?: unknown };
      const latestVersion = typeof body.version === "string" ? body.version : null;
      if (latestVersion === null) throw new Error("registry response had no version");

      const newer = compareVersions(latestVersion, options.currentVersion) > 0;
      return {
        status: newer ? "update_available" : "up_to_date",
        currentVersion: options.currentVersion,
        latestVersion,
        packageName,
        checkedAt: new Date().toISOString(),
        detail: null,
      };
    } catch (error) {
      return {
        status: "unknown",
        currentVersion: options.currentVersion,
        latestVersion: null,
        packageName,
        checkedAt: new Date().toISOString(),
        detail: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  };

  const run = async (): Promise<UpdateCheckDTO> => {
    // Never overlap checks: a slow registry must not queue up requests.
    if (inFlight !== null) return inFlight;
    inFlight = check().finally(() => {
      inFlight = null;
    });
    const result = await inFlight;
    latest = result;
    options.onResult?.(result);
    return result;
  };

  const timer = setInterval(() => {
    void run();
  }, intervalMs);
  // Do not keep the process alive just for the update check.
  timer.unref?.();

  return {
    current: () => latest,
    check: run,
    stop: () => clearInterval(timer),
  };
}
