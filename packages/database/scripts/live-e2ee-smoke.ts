/**
 * M1 live E2EE smoke test — real API + real PostgreSQL + real Telegram.
 *
 * Verifies the encrypted upload/download/recovery pipeline against a running
 * OmniCloud instance and records every check as pass/fail. Disposables only:
 * creates its own throwaway session, files, and recovery record, then removes
 * them. The URK/code are test material generated here and discarded.
 *
 * Usage:
 *   apps/api/node_modules/tsx/dist/cli.mjs packages/database/scripts/live-e2ee-smoke.ts \
 *     <api-base-url> <api-log-file>
 *
 * Exit code 0 = all checks passed.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  createRecoveryBlob,
  decryptFile,
  encryptFile,
  generateRecoveryCode,
  generateUrk,
  openRecoveryBlob,
  parseRecoveryCode,
  readHeader,
} from "../../crypto/src/index";

const PLAINTEXT_MARKER = "M1-SMOKE-PLAINTEXT-8f3ac2";
const FILE_NAME = "m1-smoke.bin";
const LEGACY_NAME = "m1-legacy.txt";
const CHUNK = 64 * 1024;
const ENCRYPTED_SIZE = 200 * 1024; // 4 chunks at 64 KiB + manifest

const apiBase = (process.argv[2] ?? "http://127.0.0.1:4001").replace(/\/$/, "");
const apiLogPath = process.argv[3];

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
const startedAt = new Date();

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
function fromB64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}
const textMarker = new TextEncoder().encode(PLAINTEXT_MARKER);

async function api(
  method: string,
  path: string,
  cookie: string,
  body?: BodyInit,
  headers: Record<string, string> = {},
): Promise<Response> {
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: { cookie: cookie, ...headers },
    body,
  });
  return res;
}
function must(res: Response, what: string): Response {
  if (!res.ok) {
    throw new Error(`${what} failed: HTTP ${res.status}`);
  }
  return res;
}

async function upload(
  cookie: string,
  opts: { fileName: string; content: Uint8Array; fields?: Record<string, string> },
): Promise<Record<string, unknown>> {
  const form = new FormData();
  for (const [key, value] of Object.entries(opts.fields ?? {})) form.append(key, value);
  form.append("file", new File([opts.content as unknown as BlobPart], opts.fileName));
  const res = must(await api("POST", "/api/files", cookie, form, {}), `upload ${opts.fileName}`);
  const json = (await res.json()) as { file: Record<string, unknown> };
  return json.file;
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

  // ── 2. Mint a short-lived browser session (same construction as the app) ──
  const token = randomBytes(32).toString("base64url");
  const sessionId = `smoke${Date.now()}${randomBytes(4).toString("hex")}`;
  await prisma.browserSession.create({
    data: {
      id: sessionId,
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      userAgent: "m1-live-e2ee-smoke",
      ip: "127.0.0.1",
    },
  });
  const cookie = `omnicloud_session=${token}`;
  check("temporary session minted", true, `id=${sessionId}`);

  let encryptedId: string | null = null;
  let legacyId: string | null = null;
  let recoveryPut = false;

  try {
    // ── 3. Legacy plaintext upload (must stay legacy) ───────────────────────
    const legacyContent = new TextEncoder().encode(
      `${PLAINTEXT_MARKER}\nlegacy upload for the M1 smoke test\n`,
    );
    const legacyFile = await upload(cookie, { fileName: LEGACY_NAME, content: legacyContent });
    legacyId = String(legacyFile.id);
    check(
      "legacy upload stores encryptionFormat=null",
      legacyFile.encryptionFormat === null,
      `id=${legacyId}`,
    );

    // ── 4. Encrypted upload through the live API ────────────────────────────
    const urk = generateUrk();
    const urkHex = Buffer.from(urk).toString("hex");
    const plaintext = new Uint8Array(ENCRYPTED_SIZE);
    for (let i = 0; i < plaintext.length; i++) plaintext[i] = (i * 31 + 7) & 0xff;
    plaintext.set(textMarker, 1024);

    const encrypted = await encryptFile(plaintext, {
      urk,
      metadata: { name: FILE_NAME, mimeType: "application/octet-stream" },
      chunkSize: CHUNK,
    });
    const encFile = await upload(cookie, {
      fileName: FILE_NAME,
      content: encrypted.envelope,
      fields: {
        encryptionFormat: "OCE1",
        wrappedKey: b64(encrypted.wrappedKey),
        metadataBlob: b64(encrypted.metadataBlob),
        keyEpoch: String(encrypted.keyEpoch),
      },
    });
    encryptedId = String(encFile.id);
    check(
      "encrypted upload accepted as OCE1",
      encFile.encryptionFormat === "OCE1" && encFile.keyEpoch === 0,
      `id=${encryptedId}`,
    );

    // ── 5. Metadata endpoint returns the opaque fields unchanged ────────────
    const metaRes = must(await api("GET", `/api/files/${encryptedId}`, cookie), "get metadata");
    const meta = ((await metaRes.json()) as { file: Record<string, unknown> }).file;
    check(
      "metadata round-trips opaque fields",
      meta.wrappedKey === b64(encrypted.wrappedKey) &&
        meta.metadataBlob === b64(encrypted.metadataBlob),
    );

    // ── 6. Database stores only opaque encryption data ──────────────────────
    const row = await prisma.file.findUnique({ where: { id: encryptedId } });
    const rowJson = JSON.stringify(row, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    check(
      "db row has OCE1 fields",
      row?.encryptionFormat === "OCE1" && row?.keyEpoch === 0 && (row?.wrappedKey?.length ?? 0) > 0,
      `wrappedKeyChars=${row?.wrappedKey?.length ?? 0}, metadataBlobChars=${row?.metadataBlob?.length ?? 0}`,
    );
    check("db row does not contain the URK", !rowJson.includes(urkHex));
    check("db row does not contain plaintext", !rowJson.includes(PLAINTEXT_MARKER));

    // ── 7. Download streams the Telegram object; verify OCE1 magic ─────────
    const dlRes = must(await api("GET", `/api/files/${encryptedId}/download`, cookie), "download");
    const downloaded = new Uint8Array(await dlRes.arrayBuffer());
    const magicOk =
      downloaded[0] === 0x4f &&
      downloaded[1] === 0x43 &&
      downloaded[2] === 0x45 &&
      downloaded[3] === 0x31;
    check(
      "downloaded object starts with OCE1 magic (ciphertext at Telegram)",
      magicOk,
      `bytes=${downloaded.length}`,
    );
    check("envelope size unchanged by storage", downloaded.length === encrypted.envelope.length);

    // Base64 DTO fields must be decoded before the crypto API (Uint8Array).
    const storedWrappedKey = fromB64(String(meta.wrappedKey));
    const storedMetadataBlob = fromB64(String(meta.metadataBlob));

    // ── 8. Client-side decrypt of the live roundtrip ────────────────────────
    try {
      const header = readHeader(downloaded);
      const restored = await decryptFile({
        urk,
        fileId: header.fileId,
        versionId: header.versionId,
        keyEpoch: header.keyEpoch,
        envelope: downloaded,
        wrappedKey: storedWrappedKey,
        metadataBlob: storedMetadataBlob,
      });
      const same =
        restored.plaintext.length === plaintext.length &&
        restored.plaintext.every((b, i) => b === plaintext[i]);
      check(
        "live download decrypts to original plaintext",
        same,
        `len=${restored.plaintext.length}`,
      );
      check("encrypted metadata survives the trip", restored.metadata.name === FILE_NAME);
    } catch (error) {
      check("live download decrypts to original plaintext", false, String(error));
    }

    // ── 9. Negative: wrong key and tampering fail closed ────────────────────
    try {
      await decryptFile({
        urk: generateUrk(),
        fileId: readHeader(downloaded).fileId,
        versionId: readHeader(downloaded).versionId,
        envelope: downloaded,
        wrappedKey: storedWrappedKey,
        metadataBlob: storedMetadataBlob,
      });
      check("wrong key rejected", false, "decryption unexpectedly succeeded");
    } catch (error) {
      check("wrong key rejected", error instanceof Error, (error as Error).name);
    }
    try {
      const tampered = downloaded.slice();
      tampered[tampered.length - 1]! ^= 0x80;
      const header = readHeader(tampered);
      await decryptFile({
        urk,
        fileId: header.fileId,
        versionId: header.versionId,
        envelope: tampered,
        wrappedKey: storedWrappedKey,
        metadataBlob: storedMetadataBlob,
      });
      check("tampered envelope rejected", false, "decryption unexpectedly succeeded");
    } catch (error) {
      check(
        "tampered envelope rejected",
        (error as Error).name === "AuthenticationError" ||
          (error as Error).name === "ManifestError",
        (error as Error).name,
      );
    }

    // ── 10. Recovery record through the live API ────────────────────────────
    const recovery = generateRecoveryCode();
    const blob = b64(createRecoveryBlob(urk, recovery.bytes));
    const putRes = await api(
      "PUT",
      "/api/auth/recovery",
      cookie,
      JSON.stringify({ recoveryBlob: blob }),
      {
        "content-type": "application/json",
      },
    );
    recoveryPut = putRes.ok;
    check("recovery record stored", putRes.ok, `HTTP ${putRes.status}`);
    const getRes = must(await api("GET", "/api/auth/recovery", cookie), "get recovery");
    const stored = ((await getRes.json()) as { recoveryBlob: string | null }).recoveryBlob;
    check("recovery record returns unchanged ciphertext", stored === blob);
    if (stored) {
      try {
        const restoredUrk = openRecoveryBlob(fromB64(stored), parseRecoveryCode(recovery.code));
        check(
          "recovery code opens the record",
          Buffer.from(restoredUrk).toString("hex") === urkHex,
        );
      } catch (error) {
        check("recovery code opens the record", false, String(error));
      }
    }
    try {
      openRecoveryBlob(fromB64(blob), parseRecoveryCode(generateRecoveryCode().code));
      check("wrong recovery code rejected", false, "opened unexpectedly");
    } catch {
      check("wrong recovery code rejected", true);
    }
    const delRes = await api("DELETE", "/api/auth/recovery", cookie);
    check("recovery record cleaned up", delRes.ok);
    recoveryPut = false;

    // ── 11. Activity/metadata sweep: no key material or plaintext anywhere ─
    const events = await prisma.activityEvent.findMany({
      where: { userId: user.id, createdAt: { gte: startedAt } },
      take: 50,
    });
    const eventsJson = JSON.stringify(events);
    check("activity events contain no URK", !eventsJson.includes(urkHex));
    check(
      "activity events contain no recovery code",
      !eventsJson.includes(recovery.code.replace(/-/g, "")),
    );
    check("activity events contain no plaintext marker", !eventsJson.includes(PLAINTEXT_MARKER));

    // ── 12. API process log: no secrets or plaintext were emitted ──────────
    if (apiLogPath && apiLogPath.length > 0) {
      const log = readFileSync(apiLogPath, "utf8");
      check("api log contains no URK", !log.includes(urkHex));
      check("api log contains no plaintext marker", !log.includes(PLAINTEXT_MARKER));
      check("api log contains no recovery code", !log.includes(recovery.code.replace(/-/g, "")));
    } else {
      check("api log scanned", false, "no log path supplied");
    }

    // ── 13. Legacy download still works (plaintext compatibility) ──────────
    const legacyDl = must(
      await api("GET", `/api/files/${legacyId}/download`, cookie),
      "legacy download",
    );
    const legacyBytes = new Uint8Array(await legacyDl.arrayBuffer());
    check(
      "legacy file still downloads as plaintext",
      legacyBytes.every((b, i) => b === legacyContent[i]),
    );
  } finally {
    // ── Cleanup: test artifacts and the temporary session ───────────────────
    for (const id of [encryptedId, legacyId].filter((x): x is string => x !== null)) {
      try {
        const res = await api("DELETE", `/api/files/${id}`, cookie);
        if (!res.ok) {
          await api("POST", `/api/files/${id}/trash`, cookie, "");
          await api("DELETE", `/api/files/${id}`, cookie);
        }
      } catch {
        // Recorded below via the existence check.
      }
    }
    const testIds = [encryptedId, legacyId].filter((x): x is string => x !== null);
    const remaining = await prisma.file.findMany({
      where: { id: { in: testIds } },
      select: { id: true },
    });
    check("test files removed", remaining.length === 0, `remaining=${remaining.length}`);
    if (recoveryPut) await api("DELETE", "/api/auth/recovery", cookie);
    await prisma.browserSession.deleteMany({ where: { id: sessionId } });
    const sessionLeft = await prisma.browserSession.findUnique({ where: { id: sessionId } });
    check("temporary session removed", sessionLeft === null);
  }

  const failed = checks.filter((c) => !c.pass);
  const summary = {
    total: checks.length,
    passed: checks.length - failed.length,
    failed: failed.map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ""}`),
  };
  console.log(`\nM1 SUMMARY ${JSON.stringify(summary)}`);
  await prisma.$disconnect();
  if (failed.length > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error("M1 smoke aborted:", error);
  await prisma.$disconnect();
  process.exit(2);
});
