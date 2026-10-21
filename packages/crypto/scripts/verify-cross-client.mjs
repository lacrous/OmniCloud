/**
 * Cross-client OCE1 vector verification (Web ↔ Node).
 *
 * 1. Runs the committed-vector verifier under Node (tsx).
 * 2. Bundles the same verifier with esbuild for the browser (the same
 *    transform pipeline Vite uses for the web client).
 * 3. Loads the bundle in headless Firefox through geckodriver and reads back
 *    the recomputed outputs.
 * 4. Requires Node and Firefox to agree byte-for-byte with each other and
 *    with the committed vector file.
 *
 * Usage (from packages/crypto): pnpm exec tsx scripts/verify-cross-client.mjs
 * Requires: firefox + geckodriver on PATH.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");

const { build } = createRequire(join(pkgRoot, "package.json"))("esbuild");

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

// --- 1. Node side -----------------------------------------------------------

const tsx = join(pkgRoot, "node_modules", ".bin", "tsx");
const nodeRun = spawnSync(tsx, [join(here, "verify-vectors-node.ts"), "--json"], {
  encoding: "utf8",
  cwd: pkgRoot,
});
if (nodeRun.status !== 0) {
  console.error(nodeRun.stdout);
  console.error(nodeRun.stderr);
  fail("node verifier exited non-zero");
}
const nodeReport = JSON.parse(nodeRun.stdout.trim());
console.log(`node: pass=${nodeReport.pass} runtime=${nodeReport.runtime}`);
if (!nodeReport.pass) fail("node verifier reported failures");

// --- 2. Browser bundle ------------------------------------------------------

// Snap-confined Firefox cannot see /tmp (private mount namespace), so the
// harness lives inside the workspace where the browser process can read it.
const cacheDir = join(pkgRoot, "node_modules", ".cache");
mkdirSync(cacheDir, { recursive: true });
const outfile = join(mkdtempSync(join(cacheDir, "ocl-vectors-")), "verifier.js");
await build({
  entryPoints: [join(here, "browser-entry.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile,
  absWorkingDir: pkgRoot,
  logLevel: "silent",
});
const bundle = readFileSync(outfile, "utf8");
const htmlPath = join(dirname(outfile), "verifier.html");
writeFileSync(
  htmlPath,
  `<!doctype html><meta charset="utf-8"><title>OCE1 cross-client vector check</title><script>${bundle}</script>`,
);
console.log(`bundle: ${outfile}`);

// --- 3. Headless Firefox via geckodriver ------------------------------------

const gdPort = "47" + String(Math.floor(Math.random() * 900) + 100);
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
    let browserReport = null;
    for (let i = 0; i < 150; i++) {
      browserReport = await gdFetch(`/session/${sessionId}/execute/sync`, {
        method: "POST",
        body: JSON.stringify({
          script: "return globalThis.__OCL_VECTOR_REPORT__ || null;",
          args: [],
        }),
      });
      if (browserReport) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!browserReport) fail("browser verifier never produced a report");
    console.log(`firefox: pass=${browserReport.pass} runtime=${browserReport.runtime}`);
    for (const field of browserReport.fields) {
      if (!field.pass) console.log(`FAIL firefox field ${field.field}`);
    }
    if (!browserReport.pass) fail("browser verifier reported failures");

    // --- 4. Byte-for-byte agreement ------------------------------------------
    const keys = Object.keys(nodeReport.outputs);
    let mismatches = 0;
    for (const key of keys) {
      if (nodeReport.outputs[key] !== browserReport.outputs[key]) {
        console.log(`FAIL output ${key} differs between node and firefox`);
        mismatches++;
      } else {
        console.log(`PASS output ${key} identical in node and firefox`);
      }
    }
    if (mismatches > 0 || keys.length === 0) fail(`${mismatches} output mismatches`);
    console.log("ALL PASS (node == firefox, both == committed vector)");
  } finally {
    await gdFetch(`/session/${sessionId}`, { method: "DELETE" }).catch(() => {});
  }
} finally {
  gd.kill();
  rmSync(dirname(outfile), { recursive: true, force: true });
}
