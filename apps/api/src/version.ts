import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The running server's version.
 *
 * It is read from the package manifest rather than hard-coded, so bumping the
 * version is a single edit. The manifest is looked for in a couple of places
 * because the server runs from two different layouts: from the source tree it
 * sits next to `apps/api/package.json`, and in the published bundle it sits
 * next to the SDK's own `package.json`, which is the manifest that ships.
 *
 * Every manifest in the repository carries the same version, and the release
 * workflow checks that they do, so whichever one is found is the same number.
 */
function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "..", "package.json"), join(here, "..", "..", "package.json")];
  for (const manifest of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(resolve(manifest), "utf8")) as { version?: unknown };
      if (typeof parsed.version === "string") return parsed.version;
    } catch {
      // Try the next candidate.
    }
  }
  return "0.0.0";
}

export const APP_VERSION: string = readVersion();
