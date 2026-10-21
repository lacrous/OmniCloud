/**
 * M4 live CLI smoke test — real API + real PostgreSQL + real Telegram.
 *
 * Runs the `omnicloud` CLI as a real subprocess against a running OmniCloud
 * instance and verifies the end-to-end encryption commands: key handling,
 * encrypted upload, decrypting download, legacy migration, and the recovery
 * record round-trip (this also exercises the bearer-token auth path on
 * /api/auth/recovery added for the CLI).
 *
 * Disposables only: mints its own API token, uploads its own files, and
 * restores any pre-existing recovery record. The URK/recovery code are test
 * material generated here and discarded. `migrate all` is deliberately NOT
 * run — it would touch pre-existing files in this account.
 *
 * Usage:
 *   node --env-file=.env apps/api/node_modules/tsx/dist/cli.mjs \
 *     packages/database/scripts/live-cli-smoke.ts <api-base-url> [api-log-file]
 *
 * Exit code 0 = all checks passed.
 */
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const PLAINTEXT_MARKER = "M4-CLI-SMOKE-PLAINTEXT-3c91ae";
const LEGACY_MARKER = "M4-CLI-SMOKE-LEGACY-b47d02";
const FILE_NAME = "m4-cli-smoke.bin";
const LEGACY_NAME = "m4-cli-legacy.txt";

const apiBase = (process.argv[2] ?? "http://127.0.0.1:4001").replace(/\/$/, "");
const apiLogPath = process.argv[3];
const repoRoot = resolve(new URL("../../..", import.meta.url).pathname);
const tsxCli = join(repoRoot, "apps/api/node_modules/tsx/dist/cli.mjs");
const cliPath = join(repoRoot, "packages/sdk/src/cli.ts");

interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}
const checks: Check[] = [];
function check(name: string, pass: boolean, detail?: string) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const prisma = new PrismaClient();

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

interface CliRun {
  code: number;
  out: string;
}

/** Runs the CLI with piped stdio (no TTY — the common script case). */
function runCli(args: string[]): CliRun {
  const res = spawnSync(process.execPath, [tsxCli, cliPath, ...args], {
    encoding: "utf8",
    timeout: 120_000,
  });
  return { code: res.status ?? -1, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

/**
 * Runs the CLI under a real pty (via `script -qec`) so `--reveal` sees a TTY.
 * `input` (if given) is fed to the pty as the command's stdin.
 */
function runCliTty(args: string[], input?: string): CliRun {
  const cmd = [process.execPath, tsxCli, cliPath, ...args].map(shellQuote).join(" ");
  const res = spawnSync("script", ["-qec", cmd, "/dev/null"], {
    encoding: "utf8",
    timeout: 120_000,
    ...(input !== undefined ? { input } : {}),
  });
  return { code: res.status ?? -1, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

function fingerprintOf(urkHex: string): string {
  // Mirrors keyFingerprint: first 16 hex chars of sha256(urk).
  return createHash("sha256").update(Buffer.from(urkHex, "hex")).digest("hex").slice(0, 16);
}

async function apiJson(
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}`);
  return res.json();
}

async function main() {
  // ── 1. Environment and account ───────────────────────────────────────────
  const health = await fetch(`${apiBase}/api/health`);
  check("api reachable", health.ok, `HTTP ${health.status}`);

  const user = await prisma.user.findFirst({
    where: { telegramSession: { isNot: null }, storages: { some: {} } },
    orderBy: { createdAt: "desc" },
  });
  check(
    "account with Telegram session and storage",
    user !== null,
    user ? `user=${user.username ?? user.id}` : "none — sign in via the browser first",
  );
  if (!user) throw new Error("no usable account; run the browser sign-in first");

  // ── 2. Mint a disposable API token (the CLI's auth mechanism) ────────────
  const token = randomBytes(32).toString("base64url");
  const tokenRow = await prisma.apiToken.create({
    data: { userId: user.id, name: "m4-cli-smoke", tokenHash: hashToken(token) },
  });
  check("temporary API token minted", true, `id=${tokenRow.id}`);

  const dir = mkdtempSync(join(tmpdir(), "omnicloud-m4-"));
  const configPath = join(dir, "config.json");
  const keyfilePath = join(dir, "root.key");
  const restoredKeyPath = join(dir, "restored.key");
  writeFileSync(configPath, `${JSON.stringify({ url: apiBase, token }, null, 2)}\n`, {
    mode: 0o600,
  });
  chmodSync(configPath, 0o600);

  let uploadId: string | null = null;
  let legacyId: string | null = null;
  const originalRecovery = (
    (await apiJson("GET", "/api/auth/recovery", token)) as { recoveryBlob: string | null }
  ).recoveryBlob;
  let recoveryModified = false;

  try {
    // ── 3. key generate / key status ───────────────────────────────────────
    const gen = runCli(["key", "generate", "--config", configPath, "--keyfile", keyfilePath]);
    check("key generate exits 0", gen.code === 0, gen.code === 0 ? undefined : gen.out.trim());
    check("keyfile written at mode 600", (statSync(keyfilePath).mode & 0o777) === 0o600);
    const keyfileJson = JSON.parse(readFileSync(keyfilePath, "utf8")) as { urkHex: string };
    const urkHex = keyfileJson.urkHex;
    const fingerprint = fingerprintOf(urkHex);
    check(
      "key generate output has fingerprint, not the key",
      gen.out.includes(fingerprint) && !gen.out.includes(urkHex),
    );

    const status = runCli(["key", "status", "--config", configPath, "--keyfile", keyfilePath]);
    check(
      "key status prints the same fingerprint",
      status.code === 0 && status.out.includes(fingerprint) && !status.out.includes(urkHex),
      status.code === 0 ? undefined : status.out.trim(),
    );

    const revealNoTty = runCli(["key", "generate", "--config", configPath, "--reveal"]);
    check(
      "key generate --reveal refuses a non-TTY pipe",
      revealNoTty.code !== 0 && /interactive terminal/.test(revealNoTty.out),
      `exit=${revealNoTty.code}`,
    );

    // ── 4. upload --encrypt (real Telegram object) ─────────────────────────
    const plaintext = new Uint8Array(128 * 1024);
    for (let i = 0; i < plaintext.length; i++) plaintext[i] = (i * 17 + 5) & 0xff;
    plaintext.set(new TextEncoder().encode(PLAINTEXT_MARKER), 2048);
    const sourcePath = join(dir, FILE_NAME);
    writeFileSync(sourcePath, plaintext);

    const up = runCli([
      "upload",
      sourcePath,
      "--encrypt",
      "--config",
      configPath,
      "--keyfile",
      keyfilePath,
    ]);
    const upId = /file (\S+)/.exec(up.out)?.[1] ?? null;
    check(
      "upload --encrypt exits 0",
      up.code === 0 && upId !== null,
      up.out.trim().split("\n").pop(),
    );
    uploadId = upId;
    if (uploadId) {
      const row = await prisma.file.findUnique({ where: { id: uploadId } });
      const rowJson = JSON.stringify(row, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
      check("db row is OCE1", row?.encryptionFormat === "OCE1", `id=${uploadId}`);
      check(
        "db row has no URK and no plaintext",
        !rowJson.includes(urkHex) && !rowJson.includes(PLAINTEXT_MARKER),
      );
    }

    // ── 5. download raw vs --decrypt ───────────────────────────────────────
    if (uploadId) {
      const rawPath = join(dir, "raw.bin");
      const raw = runCli(["download", uploadId, "-o", rawPath, "--config", configPath]);
      const rawBytes = readFileSync(rawPath);
      const isOce1 = rawBytes[0] === 0x4f && rawBytes[1] === 0x43;
      check(
        "raw download exits 0 and is ciphertext",
        raw.code === 0 && isOce1 && !rawBytes.includes(Buffer.from(PLAINTEXT_MARKER)),
        `magic=${rawBytes.subarray(0, 2).toString("latin1")}`,
      );
      check("raw download warns about --decrypt", raw.out.includes("--decrypt"));

      const decPath = join(dir, "decrypted.bin");
      const dec = runCli([
        "download",
        uploadId,
        "--decrypt",
        "-o",
        decPath,
        "--config",
        configPath,
        "--keyfile",
        keyfilePath,
      ]);
      const decOk = dec.code === 0 && readFileSync(decPath).equals(Buffer.from(plaintext));
      check(
        "--decrypt recovers the exact original bytes",
        decOk,
        dec.code === 0 ? undefined : dec.out.trim(),
      );
    }

    // ── 6. legacy upload (direct, plaintext) + migrate via CLI ─────────────
    const legacyContent = new TextEncoder().encode(
      `${LEGACY_MARKER}\nlegacy file for the M4 CLI smoke\n`,
    );
    const form = new FormData();
    form.append("file", new File([legacyContent as unknown as BlobPart], LEGACY_NAME));
    const upRes = await fetch(`${apiBase}/api/files`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    if (upRes.ok) {
      legacyId = String(((await upRes.json()) as { file: { id: string } }).file.id);
    }
    check("legacy upload accepted via bearer token", upRes.ok, `id=${legacyId}`);

    if (legacyId) {
      const mig = runCli(["migrate", legacyId, "--config", configPath, "--keyfile", keyfilePath]);
      const row = await prisma.file.findUnique({ where: { id: legacyId } });
      check(
        "migrate exits 0 and stores OCE1",
        mig.code === 0 && row?.encryptionFormat === "OCE1",
        mig.out.trim().split("\n").pop(),
      );
      const plaintextVersions = await prisma.fileVersion.count({
        where: { fileId: legacyId, encryptionFormat: null },
      });
      check(
        "plaintext predecessor pruned",
        plaintextVersions === 0,
        `plaintextVersions=${plaintextVersions}`,
      );

      const legacyDecPath = join(dir, "legacy-decrypted.txt");
      const legacyDec = runCli([
        "download",
        legacyId,
        "--decrypt",
        "-o",
        legacyDecPath,
        "--config",
        configPath,
        "--keyfile",
        keyfilePath,
      ]);
      const legacyOk =
        legacyDec.code === 0 && readFileSync(legacyDecPath).equals(Buffer.from(legacyContent));
      check(
        "migrated file decrypts to the original",
        legacyOk,
        legacyDec.code === 0 ? undefined : legacyDec.out.trim(),
      );
    }

    // ── 7. recovery generate + restore under a real pty ────────────────────
    const genRec = runCliTty([
      "recovery",
      "generate",
      "--config",
      configPath,
      "--keyfile",
      keyfilePath,
      "--reveal",
    ]);
    const codeMatch = /Recovery code: ([0-9a-f]{8}(?:-[0-9a-f]{8}){7})/.exec(genRec.out);
    check(
      "recovery generate (pty) exits 0 and shows the code",
      genRec.code === 0 && codeMatch !== null,
      genRec.code === 0 ? undefined : genRec.out.trim().split("\n").slice(-2).join(" | "),
    );
    if (codeMatch) {
      recoveryModified = true;
      const stored = (
        (await apiJson("GET", "/api/auth/recovery", token)) as { recoveryBlob: string | null }
      ).recoveryBlob;
      check("recovery blob stored server-side", typeof stored === "string" && stored.length > 0);

      const restore = runCliTty(
        ["recovery", "restore", "--config", configPath, "--keyfile", restoredKeyPath],
        `${codeMatch[1]}\n`,
      );
      let sameKey = false;
      try {
        const restored = JSON.parse(readFileSync(restoredKeyPath, "utf8")) as { urkHex: string };
        sameKey = restored.urkHex === urkHex;
      } catch {
        sameKey = false;
      }
      check(
        "recovery restore (pty) recovers the same root key",
        restore.code === 0 && sameKey,
        restore.code === 0 ? undefined : restore.out.trim().split("\n").slice(-2).join(" | "),
      );
    }

    // ── 8. API log scan ────────────────────────────────────────────────────
    if (apiLogPath) {
      const log = readFileSync(apiLogPath, "utf8");
      check("api log has no URK", !log.includes(urkHex));
      check(
        "api log has no plaintext markers",
        !log.includes(PLAINTEXT_MARKER) && !log.includes(LEGACY_MARKER),
      );
      if (codeMatch) {
        check("api log has no recovery code", !log.includes(codeMatch[1].replace(/-/g, "")));
      }
    } else {
      check("api log scanned", false, "no log path supplied");
    }
  } finally {
    // ── Cleanup: files, token, recovery record, temp dir ───────────────────
    for (const id of [uploadId, legacyId].filter((x): x is string => x !== null)) {
      try {
        const res = await fetch(`${apiBase}/api/files/${id}`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          await fetch(`${apiBase}/api/files/${id}/trash`, {
            method: "POST",
            headers: { authorization: `Bearer ${token}` },
          });
          await fetch(`${apiBase}/api/files/${id}`, {
            method: "DELETE",
            headers: { authorization: `Bearer ${token}` },
          });
        }
      } catch {
        // Reported by the existence check below.
      }
    }
    const testIds = [uploadId, legacyId].filter((x): x is string => x !== null);
    const remaining = await prisma.file.findMany({
      where: { id: { in: testIds } },
      select: { id: true },
    });
    check("test files removed", remaining.length === 0, `remaining=${remaining.length}`);

    if (recoveryModified) {
      // Put back exactly what was there before (or clear if it was empty).
      try {
        if (originalRecovery !== null) {
          await fetch(`${apiBase}/api/auth/recovery`, {
            method: "PUT",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({ recoveryBlob: originalRecovery }),
          });
        } else {
          await fetch(`${apiBase}/api/auth/recovery`, {
            method: "DELETE",
            headers: { authorization: `Bearer ${token}` },
          });
        }
      } catch {
        // Best effort; the record itself is only ciphertext.
      }
      const after = (
        (await apiJson("GET", "/api/auth/recovery", token)) as { recoveryBlob: string | null }
      ).recoveryBlob;
      check("previous recovery record restored", after === originalRecovery);
    }

    await prisma.apiToken.deleteMany({ where: { id: tokenRow.id } });
    const tokenLeft = await prisma.apiToken.findUnique({ where: { id: tokenRow.id } });
    check("temporary API token removed", tokenLeft === null);
    rmSync(dir, { recursive: true, force: true });
  }

  const failed = checks.filter((c) => !c.pass);
  const summary = {
    total: checks.length,
    passed: checks.length - failed.length,
    failed: failed.map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ""}`),
  };
  console.log(`\nM4 SUMMARY ${JSON.stringify(summary)}`);
  await prisma.$disconnect();
  if (failed.length > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error("M4 smoke aborted:", error);
  await prisma.$disconnect();
  process.exit(2);
});
