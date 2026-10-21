/**
 * M2 live migration smoke — drives migrateFile against the real API/Telegram.
 *
 * Three scenarios on disposable files: fresh single-version migration, PENDING
 * resume (replace pre-committed, cleanup not done), and idempotent rerun.
 * Cleans up every artifact it creates.
 *
 * Usage:
 *   node --env-file=.env apps/api/node_modules/tsx/dist/cli.mjs \
 *     packages/database/scripts/live-migration-smoke.ts <api-base-url>
 *
 * Exit code 0 = all checks passed.
 */
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { encryptFile } from "../../crypto/src/index";
import { OmniCloudClient } from "../../sdk/src/client";
import { downloadEncrypted, migrateFile } from "../../sdk/src/encryption";

const apiBase = (process.argv[2] ?? "http://127.0.0.1:4001").replace(/\/$/, "");
const MARKER = "M2-MIGRATION-SMOKE-4c7e";

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

function fixture(label: string): Uint8Array {
  const base = `${MARKER}\n${label}\n`;
  const bytes = new Uint8Array(150 * 1024);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 13 + 7) & 0xff;
  bytes.set(new TextEncoder().encode(base), 0);
  return bytes;
}
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

let cookie = "";
async function api(
  method: string,
  path: string,
  body?: BodyInit,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${apiBase}${path}`, { method, headers: { cookie, ...headers }, body });
}
function must(res: Response, what: string): Response {
  if (!res.ok) throw new Error(`${what} failed: HTTP ${res.status}`);
  return res;
}

async function uploadLegacy(fileName: string, content: Uint8Array): Promise<string> {
  const form = new FormData();
  form.append("file", new File([content as unknown as BlobPart], fileName));
  const res = must(await api("POST", "/api/files", form), `upload ${fileName}`);
  const json = (await res.json()) as { file: { id: string } };
  return json.file.id;
}

/** Pre-commits an encrypted replace so migrateFile must resume (PENDING path). */
async function replaceWithEncrypted(
  fileId: string,
  content: Uint8Array,
  urk: Uint8Array,
): Promise<void> {
  const encrypted = await encryptFile(content, {
    urk,
    metadata: { name: "m2-resume.bin", mimeType: "application/octet-stream" },
  });
  const form = new FormData();
  form.append("encryptionFormat", "OCE1");
  form.append("wrappedKey", Buffer.from(encrypted.wrappedKey).toString("base64"));
  form.append("metadataBlob", Buffer.from(encrypted.metadataBlob).toString("base64"));
  form.append("keyEpoch", String(encrypted.keyEpoch));
  form.append("file", new File([encrypted.envelope as unknown as BlobPart], "m2-resume.bin"));
  must(await api("POST", `/api/files/${fileId}/replace`, form), "pre-replace");
}

async function getFile(id: string): Promise<Record<string, unknown>> {
  const res = must(await api("GET", `/api/files/${id}`), "get file");
  return ((await res.json()) as { file: Record<string, unknown> }).file;
}

async function getVersions(id: string): Promise<Record<string, unknown>[]> {
  const res = must(await api("GET", `/api/files/${id}/versions`), "get versions");
  const json = (await res.json()) as { versions: Record<string, unknown>[] };
  return json.versions;
}

async function main() {
  const health = await fetch(`${apiBase}/api/health`);
  check("api reachable", health.ok, `HTTP ${health.status}`);

  const user = await prisma.user.findFirst({
    where: { telegramSession: { isNot: null }, storages: { some: {} } },
    orderBy: { createdAt: "desc" },
  });
  check("account with Telegram session and storage", user !== null);
  if (!user) throw new Error("no usable account; sign in via the browser first");

  const token = randomBytes(32).toString("base64url");
  const sessionId = `m2smoke${Date.now()}${randomBytes(4).toString("hex")}`;
  await prisma.browserSession.create({
    data: {
      id: sessionId,
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      userAgent: "m2-live-migration-smoke",
      ip: "127.0.0.1",
    },
  });
  cookie = `omnicloud_session=${token}`;

  const client = new OmniCloudClient({
    baseUrl: apiBase,
    headers: { cookie },
    retry: { attempts: 1, baseDelayMs: 1 },
  });
  const urk = randomBytes(32);

  const created: string[] = [];
  try {
    // ── Scenario 1: fresh single-version migration ─────────────────────────
    const freshContent = fixture("fresh-run");
    const freshId = await uploadLegacy("m2-fresh.bin", freshContent);
    created.push(freshId);
    const legacyFile = await getFile(freshId);
    check("fresh fixture starts legacy", legacyFile.encryptionFormat === null, `id=${freshId}`);

    const freshResult = await migrateFile(client, freshId, { urk });
    check(
      "fresh migration reports migrated/0 remaining",
      freshResult.status === "migrated" && freshResult.plaintextVersionsRemaining === 0,
      `status=${freshResult.status}`,
    );
    const freshAfter = await getFile(freshId);
    check("fresh file is OCE1 after migrate", freshAfter.encryptionFormat === "OCE1");
    const freshVersions = (await getVersions(freshId)) as { encryptionFormat?: string | null }[];
    check(
      "plaintext predecessor removed (versions = 1 encrypted)",
      freshVersions.length === 1 && (freshVersions[0]?.encryptionFormat ?? null) === "OCE1",
      `versions=${freshVersions.length}`,
    );
    try {
      const restored = await downloadEncrypted(client, freshId, { urk });
      check(
        "migrated file decrypts to the original plaintext",
        bytesEqual(restored.plaintext, freshContent),
        `len=${restored.plaintext.length}`,
      );
    } catch (error) {
      check("migrated file decrypts to the original plaintext", false, String(error));
    }

    // ── Scenario 2: PENDING resume (pre-replaced, cleanup not done) ────────
    const resumeContent = fixture("pending-resume");
    const resumeId = await uploadLegacy("m2-resume.bin", resumeContent);
    created.push(resumeId);
    await replaceWithEncrypted(resumeId, resumeContent, urk);
    const pendingFile = await getFile(resumeId);
    const pendingVersions = (await getVersions(resumeId)) as { encryptionFormat?: string | null }[];
    check(
      "pending state reached (OCE1 current + plaintext history)",
      pendingFile.encryptionFormat === "OCE1" &&
        pendingVersions.some((v) => (v.encryptionFormat ?? null) === null),
      `versions=${pendingVersions.length}`,
    );

    const resumeResult = await migrateFile(client, resumeId, { urk });
    check(
      "resume verifies via recorded hash and finishes",
      resumeResult.status === "migrated" && resumeResult.plaintextVersionsRemaining === 0,
      `status=${resumeResult.status}`,
    );
    const resumeVersions = (await getVersions(resumeId)) as { encryptionFormat?: string | null }[];
    check(
      "resume cleaned up the plaintext predecessor",
      resumeVersions.length === 1 && (resumeVersions[0]?.encryptionFormat ?? null) === "OCE1",
      `versions=${resumeVersions.length}`,
    );

    // ── Scenario 3: idempotent rerun ───────────────────────────────────────
    const rerun = await migrateFile(client, freshId, { urk });
    check(
      "rerun reports already_migrated",
      rerun.status === "already_migrated" && rerun.plaintextVersionsRemaining === 0,
      `status=${rerun.status}`,
    );
    const rerunVersions = (await getVersions(freshId)) as unknown[];
    check(
      "rerun did not add versions",
      rerunVersions.length === 1,
      `versions=${rerunVersions.length}`,
    );
  } finally {
    for (const id of created) {
      try {
        const res = await api("DELETE", `/api/files/${id}`);
        if (!res.ok) {
          await api("POST", `/api/files/${id}/trash`, "");
          await api("DELETE", `/api/files/${id}`);
        }
      } catch {
        // Checked below.
      }
    }
    const remaining = await prisma.file.findMany({
      where: { id: { in: created } },
      select: { id: true },
    });
    check("test files removed", remaining.length === 0, `remaining=${remaining.length}`);
    await prisma.browserSession.deleteMany({ where: { id: sessionId } });
    const sessionLeft = await prisma.browserSession.findUnique({ where: { id: sessionId } });
    check("temporary session removed", sessionLeft === null);
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(
    `\nM2 SUMMARY ${JSON.stringify({
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ""}`),
    })}`,
  );
  await prisma.$disconnect();
  if (failed.length > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error("M2 smoke aborted:", error);
  await prisma.$disconnect();
  process.exit(2);
});
