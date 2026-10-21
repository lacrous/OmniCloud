/**
 * M5 web streaming benchmark orchestrator (plan item 1).
 *
 * Bundles the browser benchmark entry with esbuild (resolved through Vite, so
 * no version is hardcoded), loads it in headless Firefox via geckodriver, and
 * reads the result back. This is the browser counterpart to the SDK evidence in
 * `docs/evidence/streaming-memory.md`.
 *
 * Usage: pnpm --filter @omnicloud/web bench:web-streaming
 * Requires: firefox + geckodriver on PATH (same requirement as the existing
 * `verify:vectors:cross-client` harness in packages/crypto).
 *
 * Note: snap-confined Firefox cannot read /tmp (private mount namespace), so
 * the bundle is written under the package's node_modules/.cache.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");

// esbuild is a Vite dependency, not a direct one: resolve it through Vite's
// own require context so no pnpm-store version is hardcoded.
const reqFromPkg = createRequire(join(pkgRoot, "package.json"));
const reqFromVite = createRequire(reqFromPkg.resolve("vite/package.json"));
const { build } = reqFromVite("esbuild");

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

const sizes = (process.env.BENCH_SIZES ?? "32,256")
  .split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isInteger(n) && n > 0);

// --- 1. Bundle ---------------------------------------------------------------

const cacheDir = join(pkgRoot, "node_modules", ".cache");
mkdirSync(cacheDir, { recursive: true });
const outDir = mkdtempSync(join(cacheDir, "ocl-web-bench-"));
const outfile = join(outDir, "bench.js");

await build({
  entryPoints: [join(here, "browser-bench-entry.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile,
  absWorkingDir: pkgRoot,
  // The orchestrator injects the sizes via a global the entry reads, so no
  // define is needed; keep the banner quiet.
  logLevel: "silent",
});
console.log(`bundle: ${outfile}`);

const htmlPath = join(outDir, "bench.html");
writeFileSync(
  htmlPath,
  `<!doctype html><meta charset="utf-8"><title>OCE1 web streaming bench</title>` +
    `<script>globalThis.__OCL_BENCH_SIZES__=${JSON.stringify(sizes)};</script>` +
    `<script src="./bench.js"></script>`,
);

// --- 2. Headless Firefox via geckodriver -------------------------------------

const gdPort = String(47_000 + Math.floor(Math.random() * 900));
const gd = spawn("geckodriver", ["--port", gdPort, "--log", "fatal"], { stdio: "ignore" });
const gdBase = `http://127.0.0.1:${gdPort}`;

async function gdFetch(path, options) {
  const res = await fetch(`${gdBase}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options?.headers ?? {}) },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`geckodriver ${res.status}: ${JSON.stringify(body)}`);
  return body.value;
}

try {
  for (let i = 0; i < 50; i++) {
    try {
      await gdFetch("/status");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
      if (i === 49) fail("geckodriver did not come up");
    }
  }

  const session = await gdFetch("/session", {
    method: "POST",
    body: JSON.stringify({
      capabilities: {
        alwaysMatch: {
          browserName: "firefox",
          "moz:firefoxOptions": { args: ["-headless"] },
        },
      },
    }),
  });
  const sessionId = session.sessionId;
  try {
    await gdFetch(`/session/${sessionId}/url`, {
      method: "POST",
      body: JSON.stringify({ url: `file://${htmlPath}` }),
    });

    let report = null;
    // Large phases can take a while; poll generously.
    for (let i = 0; i < 1200; i++) {
      report = await gdFetch(`/session/${sessionId}/execute/sync`, {
        method: "POST",
        body: JSON.stringify({
          script: "return globalThis.__OCL_WEB_BENCH__ || null;",
          args: [],
        }),
      });
      if (report) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!report) fail("browser benchmark never produced a report");

    console.log(`WEB BENCH ${JSON.stringify(report)}`);
    for (const phase of report.phases) {
      if (phase.error) console.log(`FAIL ${phase.sizeMiB} MiB: ${phase.error}`);
      else if (!phase.envelopeLooksEncrypted) console.log(`FAIL ${phase.sizeMiB} MiB: not OCE1`);
    }
    if (!report.pass) fail("browser benchmark reported failures");
    console.log("ALL PASS (web chunked encryption produced OCE1 envelopes)");
  } finally {
    await gdFetch(`/session/${sessionId}`, { method: "DELETE" }).catch(() => {});
  }
} finally {
  gd.kill();
  rmSync(outDir, { recursive: true, force: true });
}
