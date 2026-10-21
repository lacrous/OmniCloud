import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRecoveryBlob,
  encryptFile,
  generateRecoveryCode,
  openRecoveryBlob,
  parseRecoveryCode,
} from "@omnicloud/crypto";
import { OmniCloudClient, generateUrk } from "../src/index";
import { isE2eeCommand, routesToE2ee, runE2eeCommand } from "../src/cli-e2ee";
import type { CliContext } from "../src/cli-e2ee";
import { keyFingerprint, loadConfig, readKeyfile, writeKeyfile } from "../src/cli-auth";

// ── Test harness ─────────────────────────────────────────────────────────────

const TOKEN = "t".repeat(43); // same shape as a real base64url 32-byte token

interface TestIo {
  out: string[];
  err: string[];
  answers: string[];
  tty: boolean;
}

interface Setup {
  dir: string;
  configPath: string;
  keyfilePath: string;
  io: TestIo;
  ctx: CliContext;
  requests: { url: string; init?: RequestInit }[];
}

let active: Setup | null = null;

function makeSetup(
  route: (url: string, init?: RequestInit) => Response | Promise<Response>,
  options: { tty?: boolean; answers?: string[] } = {},
): Setup {
  const dir = mkdtempSync(join(tmpdir(), "omnicloud-cli-"));
  const configPath = join(dir, "config.json");
  const keyfilePath = join(dir, "root.key");
  const io: TestIo = {
    out: [],
    err: [],
    answers: options.answers ?? [],
    tty: options.tty ?? false,
  };
  const requests: { url: string; init?: RequestInit }[] = [];
  const ctx: CliContext = {
    io: {
      out: (text) => io.out.push(text),
      err: (text) => io.err.push(text),
      prompt: async () => {
        const next = io.answers.shift();
        if (next === undefined) throw new Error("no scripted prompt answer left");
        return next;
      },
      stdoutTty: () => io.tty,
    },
    createClient: ({ baseUrl, token }) =>
      new OmniCloudClient({
        baseUrl,
        ...(token ? { token } : {}),
        retry: { attempts: 1, baseDelayMs: 1 },
        fetchImpl: async (url, init) => {
          requests.push({ url: String(url), ...(init ? { init } : {}) });
          return route(String(url), init);
        },
      }),
  };
  active = { dir, configPath, keyfilePath, io, ctx, requests };
  return active;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function withConfig(extra: Record<string, string | undefined>): void {
  const setup = active!;
  const config: Record<string, string> = { url: "http://cli.test", token: TOKEN };
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete config[key];
    else config[key] = value;
  }
  writeFileSync(setup.configPath, JSON.stringify(config, null, 2));
}

function out(setup: Setup): string {
  return setup.io.out.join("");
}

function errText(setup: Setup): string {
  return setup.io.err.join("");
}

afterEach(() => {
  if (active && existsSync(active.dir)) rmSync(active.dir, { recursive: true, force: true });
  active = null;
});

// ── key generate / key status ────────────────────────────────────────────────

describe("key generate", () => {
  it("refuses to run with no explicit destination", async () => {
    const setup = makeSetup(() => json({}));
    await expect(
      runE2eeCommand(["key", "generate", "--config", setup.configPath], setup.ctx),
    ).rejects.toThrow(/--keyfile <path>.*--reveal/);
    expect(existsSync(setup.keyfilePath)).toBe(false);
  });

  it("persists to a 0600 keyfile without printing the key", async () => {
    const setup = makeSetup(() => json({}));
    const code = await runE2eeCommand(
      ["key", "generate", "--config", setup.configPath, "--keyfile", setup.keyfilePath],
      setup.ctx,
    );
    expect(code).toBe(0);
    const mode = statSync(setup.keyfilePath).mode & 0o777;
    expect(mode).toBe(0o600);
    const urk = readKeyfile(setup.keyfilePath);
    expect(urk).toHaveLength(32);
    const printed = out(setup);
    expect(printed).toContain(keyFingerprint(urk));
    expect(printed).not.toContain(Buffer.from(urk).toString("hex"));
    expect(printed).toMatch(/recovery generate/);
  });

  it("reveals the key only with --reveal on a TTY", async () => {
    const setup = makeSetup(() => json({}), { tty: false });
    await expect(
      runE2eeCommand(["key", "generate", "--config", setup.configPath, "--reveal"], setup.ctx),
    ).rejects.toThrow(/interactive terminal/);

    setup.io.tty = true;
    const code = await runE2eeCommand(
      ["key", "generate", "--config", setup.configPath, "--reveal"],
      setup.ctx,
    );
    expect(code).toBe(0);
    const printed = out(setup);
    expect(printed).toMatch(/Root key \([0-9a-f]{64}\)/);
  });
});

describe("key status", () => {
  it("reports when no keyfile is configured", async () => {
    const setup = makeSetup(() => json({}));
    const code = await runE2eeCommand(["key", "status", "--config", setup.configPath], setup.ctx);
    expect(code).toBe(0);
    expect(out(setup)).toContain("No keyfile configured");
  });

  it("prints the fingerprint; the key only with --reveal on a TTY", async () => {
    const setup = makeSetup(() => json({}), { tty: false });
    const urk = generateUrk();
    writeKeyfile(setup.keyfilePath, urk);

    await runE2eeCommand(
      ["key", "status", "--config", setup.configPath, "--keyfile", setup.keyfilePath],
      setup.ctx,
    );
    expect(out(setup)).toContain(keyFingerprint(urk));
    expect(out(setup)).not.toContain(Buffer.from(urk).toString("hex"));

    await expect(
      runE2eeCommand(
        ["key", "status", "--config", setup.configPath, "--keyfile", setup.keyfilePath, "--reveal"],
        setup.ctx,
      ),
    ).rejects.toThrow(/interactive terminal/);

    setup.io.tty = true;
    await runE2eeCommand(
      ["key", "status", "--config", setup.configPath, "--keyfile", setup.keyfilePath, "--reveal"],
      setup.ctx,
    );
    expect(out(setup)).toContain(Buffer.from(urk).toString("hex"));
  });

  it("errors when the configured keyfile does not exist", async () => {
    const setup = makeSetup(() => json({}));
    withConfig({ keyfile: join(setup.dir, "missing.key") });
    await expect(
      runE2eeCommand(["key", "status", "--config", setup.configPath], setup.ctx),
    ).rejects.toThrow(/Could not read keyfile/);
  });
});

// ── recovery generate / restore ──────────────────────────────────────────────

describe("recovery generate", () => {
  it("requires --reveal before touching the server", async () => {
    const setup = makeSetup(() => json({}));
    withConfig({ keyfile: setup.keyfilePath });
    writeKeyfile(setup.keyfilePath, generateUrk());
    await expect(
      runE2eeCommand(["recovery", "generate", "--config", setup.configPath], setup.ctx),
    ).rejects.toThrow(/explicit --reveal/);
    expect(setup.requests).toHaveLength(0);
  });

  it("stores an opaque blob and prints the code once", async () => {
    const setup = makeSetup(
      (url, init) => {
        if (url.endsWith("/api/auth/recovery") && init?.method === "PUT")
          return json({ status: "ok" });
        return json({ error: { code: "NOT_FOUND" } }, 404);
      },
      { tty: true },
    );
    withConfig({ keyfile: setup.keyfilePath });
    const urk = generateUrk();
    writeKeyfile(setup.keyfilePath, urk);

    const code = await runE2eeCommand(
      ["recovery", "generate", "--config", setup.configPath, "--reveal"],
      setup.ctx,
    );
    expect(code).toBe(0);
    expect(setup.requests).toHaveLength(1);
    const put = initBody(setup.requests[0]!.init) as { recoveryBlob: string };
    expect(typeof put.recoveryBlob).toBe("string");
    const blob = Buffer.from(put.recoveryBlob, "base64");
    expect(blob.length).toBe(72);

    const printed = out(setup);
    const match = /Recovery code: ([0-9a-f]{8}(?:-[0-9a-f]{8}){7})/.exec(printed);
    expect(match).not.toBeNull();
    const codeBytes = parseRecoveryCode(match![1]!);
    // The stored blob must open under the printed code back to the same URK.
    const recovered = openRecoveryBlob(new Uint8Array(blob), codeBytes);
    expect(Buffer.from(recovered).toString("hex")).toBe(Buffer.from(urk).toString("hex"));
  });
});

describe("recovery restore", () => {
  function storeRecord(setup: Setup, urk: Uint8Array, code: Uint8Array): string {
    const blob = createRecoveryBlob(urk, code);
    return Buffer.from(blob).toString("base64");
  }

  it("restores the URK into a keyfile from the recovery code", async () => {
    const urk = generateUrk();
    const recovery = generateRecoveryCode();
    const setup = makeSetup(
      (url) =>
        url.endsWith("/api/auth/recovery")
          ? json({ recoveryBlob: storeRecord(setup, urk, recovery.bytes) })
          : json(null, 404),
      { answers: [recovery.code] },
    );
    withConfig({});

    const code = await runE2eeCommand(
      ["recovery", "restore", "--config", setup.configPath, "--keyfile", setup.keyfilePath],
      setup.ctx,
    );
    expect(code).toBe(0);
    const restored = readKeyfile(setup.keyfilePath);
    expect(Buffer.from(restored).toString("hex")).toBe(Buffer.from(urk).toString("hex"));
    expect(out(setup)).toContain(keyFingerprint(urk));
    expect(out(setup)).not.toContain(Buffer.from(urk).toString("hex"));
  });

  it("reports an account with no stored record", async () => {
    const setup = makeSetup((url) =>
      url.endsWith("/api/auth/recovery") ? json({ recoveryBlob: null }) : json(null, 404),
    );
    withConfig({});
    const code = await runE2eeCommand(
      ["recovery", "restore", "--config", setup.configPath, "--reveal"],
      setup.ctx,
    );
    expect(code).toBe(1);
    expect(errText(setup)).toContain("No recovery record");
    expect(setup.io.out).toHaveLength(0);
  });

  it("rejects a wrong code without writing a keyfile", async () => {
    const urk = generateUrk();
    const real = generateRecoveryCode();
    const wrong = generateRecoveryCode();
    const setup = makeSetup(
      (url) =>
        url.endsWith("/api/auth/recovery")
          ? json({ recoveryBlob: storeRecord(setup, urk, real.bytes) })
          : json(null, 404),
      { answers: [wrong.code] },
    );
    withConfig({});

    const code = await runE2eeCommand(
      ["recovery", "restore", "--config", setup.configPath, "--keyfile", setup.keyfilePath],
      setup.ctx,
    );
    expect(code).toBe(1);
    expect(existsSync(setup.keyfilePath)).toBe(false);
    expect(errText(setup)).toContain("Recovery failed");
  });

  it("demands an explicit destination", async () => {
    const setup = makeSetup(() => json({ recoveryBlob: "AA==" }), { answers: ["whatever"] });
    withConfig({});
    await expect(
      runE2eeCommand(["recovery", "restore", "--config", setup.configPath], setup.ctx),
    ).rejects.toThrow(/--keyfile <path>.*--reveal/);
    expect(setup.requests).toHaveLength(0);
  });
});

function initBody(init?: RequestInit): unknown {
  if (typeof init?.body !== "string") throw new Error("expected a JSON body");
  return JSON.parse(init.body);
}

// ── upload ───────────────────────────────────────────────────────────────────

describe("upload --encrypt", () => {
  it("refuses to run without --encrypt (no plaintext path)", async () => {
    const setup = makeSetup(() => json({}));
    withConfig({ keyfile: setup.keyfilePath });
    writeKeyfile(setup.keyfilePath, generateUrk());
    writeFileSync(join(setup.dir, "a.txt"), "hello");
    await expect(
      runE2eeCommand(["upload", join(setup.dir, "a.txt"), "--config", setup.configPath], setup.ctx),
    ).rejects.toThrow(/no plaintext upload path/);
    expect(setup.requests).toHaveLength(0);
  });

  it("requires a configured API token", async () => {
    const setup = makeSetup(() => json({}));
    withConfig({ keyfile: setup.keyfilePath, token: undefined });
    writeKeyfile(setup.keyfilePath, generateUrk());
    writeFileSync(join(setup.dir, "a.txt"), "hello");
    await expect(
      runE2eeCommand(
        ["upload", join(setup.dir, "a.txt"), "--encrypt", "--config", setup.configPath],
        setup.ctx,
      ),
    ).rejects.toThrow(/No API token configured/);
  });

  it("uploads ciphertext the server cannot read, and reports the file id", async () => {
    const plaintext = new TextEncoder().encode("cli secret payload 1234567890");
    const urk = generateUrk();
    const setup = makeSetup((url, init) => {
      if (url.endsWith("/api/files") && init?.method === "POST") {
        const boundary = /boundary=(\S+)/.exec(
          String((init.headers as Record<string, string>)["Content-Type"]),
        )?.[1];
        const parts = parseMultipart(new Uint8Array(init.body as ArrayBuffer), boundary!);
        const encryptionFormat = fieldText(parts, "encryptionFormat");
        expect(encryptionFormat).toBe("OCE1");
        const envelope = parts.find((p) => p.filename !== null)!.value;
        const wrappedKey = fieldText(parts, "wrappedKey");
        const metadataBlob = fieldText(parts, "metadataBlob");
        // The envelope on the wire must NOT contain the plaintext.
        expect(Buffer.from(envelope).includes(Buffer.from(plaintext))).toBe(false);
        return json({ file: encryptedFileDto(wrappedKey, metadataBlob) }, 201);
      }
      return json({ error: { code: "NOT_FOUND" } }, 404);
    });
    withConfig({ keyfile: setup.keyfilePath });
    writeKeyfile(setup.keyfilePath, urk);
    const source = join(setup.dir, "note.txt");
    writeFileSync(source, plaintext);

    const code = await runE2eeCommand(
      ["upload", source, "--encrypt", "--config", setup.configPath],
      setup.ctx,
    );
    expect(code).toBe(0);
    expect(out(setup)).toContain("file f-1");
    expect(out(setup)).toContain("OCE1 encrypted");
  });
});

function encryptedFileDto(wrappedKey: string, metadataBlob: string) {
  return {
    id: "f-1",
    name: "note.txt",
    size: 10,
    mimeType: "text/plain",
    sha256: "0".repeat(64),
    folderId: null,
    starred: false,
    trashed: false,
    deletedAt: null,
    versionCount: 1,
    currentVersionId: "v-1",
    encryptionFormat: "OCE1",
    wrappedKey,
    metadataBlob,
    keyEpoch: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

// ── download ─────────────────────────────────────────────────────────────────

describe("download", () => {
  const plaintext = new TextEncoder().encode("download me later");
  let urk: Uint8Array;
  let envelope: Uint8Array;
  let wrappedKey: string;
  let metadataBlob: string;

  beforeEach(async () => {
    urk = generateUrk();
    const encrypted = await encryptFile(plaintext, {
      urk,
      metadata: { name: "report.txt", mimeType: "text/plain" },
    });
    envelope = encrypted.envelope;
    wrappedKey = Buffer.from(encrypted.wrappedKey).toString("base64");
    metadataBlob = Buffer.from(encrypted.metadataBlob).toString("base64");
  });

  function routeEncryptedFile(url: string, init?: RequestInit): Response {
    if (url.endsWith("/api/files/f-1") && (!init?.method || init.method === "GET")) {
      return json({ file: encryptedFileDto(wrappedKey, metadataBlob) });
    }
    if (url.endsWith("/api/files/f-1/download")) {
      return new Response(envelope.slice().buffer as ArrayBuffer, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      });
    }
    return json({ error: { code: "NOT_FOUND" } }, 404);
  }

  it("decrypts to the original bytes with a configured keyfile", async () => {
    const setup = makeSetup(routeEncryptedFile);
    writeKeyfile(setup.keyfilePath, urk);
    withConfig({ keyfile: setup.keyfilePath });
    const target = join(setup.dir, "out.txt");
    const code = await runE2eeCommand(
      ["download", "f-1", "--decrypt", "-o", target, "--config", setup.configPath],
      setup.ctx,
    );
    expect(code).toBe(0);
    expect(readFileSync(target)).toEqual(Buffer.from(plaintext));
    expect(out(setup)).toContain("Decrypted report.txt");
  });

  it("writes ciphertext when --decrypt is absent", async () => {
    const setup = makeSetup(routeEncryptedFile);
    withConfig({});
    const target = join(setup.dir, "raw.bin");
    const code = await runE2eeCommand(
      ["download", "f-1", "-o", target, "--config", setup.configPath],
      setup.ctx,
    );
    expect(code).toBe(0);
    const written = readFileSync(target);
    expect(written.equals(Buffer.from(envelope))).toBe(true);
    expect(written.includes(Buffer.from(plaintext))).toBe(false);
    expect(out(setup)).toContain("--decrypt");
  });

  it("refuses --decrypt on a plaintext (legacy) file", async () => {
    const setup = makeSetup((url) => {
      if (url.endsWith("/api/files/f-2")) {
        return json({
          file: {
            ...encryptedFileDto("x", "y"),
            id: "f-2",
            encryptionFormat: null,
            wrappedKey: null,
            metadataBlob: null,
          },
        });
      }
      return json({ error: { code: "NOT_FOUND" } }, 404);
    });
    withConfig({});
    await expect(
      runE2eeCommand(
        [
          "download",
          "f-2",
          "--decrypt",
          "-o",
          join(setup.dir, "x"),
          "--config",
          setup.configPath,
          "--keyfile",
          setup.keyfilePath,
        ],
        setup.ctx,
      ),
    ).rejects.toThrow(/not encrypted/);
    expect(existsSync(join(setup.dir, "x"))).toBe(false);
  });
});

// ── migrate ──────────────────────────────────────────────────────────────────

describe("migrate", () => {
  it("reports a failed lookup and exits non-zero", async () => {
    const setup = makeSetup((url) => {
      if (url.endsWith("/api/files/ghost"))
        return json({ error: { code: "NOT_FOUND", message: "no such file" } }, 404);
      return json({ error: { code: "NOT_FOUND" } }, 404);
    });
    writeKeyfile(setup.keyfilePath, generateUrk());
    withConfig({ keyfile: setup.keyfilePath });
    const code = await runE2eeCommand(
      ["migrate", "ghost", "--config", setup.configPath],
      setup.ctx,
    );
    expect(code).toBe(1);
    expect(errText(setup)).toContain("FAILED ghost");
  });

  it("exits 0 with a clear message when no legacy files exist", async () => {
    const setup = makeSetup((url) => {
      if (url.endsWith("/api/files?page=1") || /\/api\/files\?/.test(url)) {
        return json({
          files: [encryptedFileDto("a", "b")],
          pagination: { page: 1, limit: 100, total: 1, hasMore: false },
        });
      }
      return json({ error: { code: "NOT_FOUND" } }, 404);
    });
    writeKeyfile(setup.keyfilePath, generateUrk());
    withConfig({ keyfile: setup.keyfilePath });
    const code = await runE2eeCommand(["migrate", "all", "--config", setup.configPath], setup.ctx);
    expect(code).toBe(0);
    expect(out(setup)).toContain("No plaintext files found");
  });

  it("rejects unknown subcommand usage", async () => {
    const setup = makeSetup(() => json({}));
    await expect(
      runE2eeCommand(["migrate", "--config", setup.configPath], setup.ctx),
    ).rejects.toThrow(/usage: omnicloud migrate/);
  });
});

// ── versions ─────────────────────────────────────────────────────────────────

describe("versions", () => {
  const fileDto = (id: string) => ({
    id,
    name: "v.txt",
    size: 3,
    mimeType: "text/plain",
    sha256: "0".repeat(64),
    folderId: null,
    starred: false,
    trashed: false,
    deletedAt: null,
    versionCount: 2,
    currentVersionId: "ver2",
    encryptionFormat: null,
    wrappedKey: null,
    metadataBlob: null,
    keyEpoch: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  });

  const versionDto = (id: string, n: number, isCurrent: boolean) => ({
    id,
    fileId: "f1",
    versionNumber: n,
    size: 3,
    mimeType: "text/plain",
    sha256: "0".repeat(64),
    telegramMessageId: 1,
    isCurrent,
    encryptionFormat: null,
    wrappedKey: null,
    metadataBlob: null,
    keyEpoch: null,
    createdAt: "2026-10-01T00:00:00.000Z",
  });

  it("lists the versions with their ids", async () => {
    const setup = makeSetup((url) => {
      if (url.endsWith("/api/files/f1/versions")) {
        return json({
          versions: [versionDto("ver2", 2, true), versionDto("ver1", 1, false)],
        });
      }
      if (url.endsWith("/api/files/f1")) return json({ file: fileDto("f1") });
      return json({ error: { code: "NOT_FOUND" } }, 404);
    });
    withConfig({});
    const code = await runE2eeCommand(["versions", "f1", "--config", setup.configPath], setup.ctx);
    expect(code).toBe(0);
    expect(out(setup)).toContain("2 version(s)");
    expect(out(setup)).toContain("v2");
    expect(out(setup)).toContain("(current)");
    expect(out(setup)).toContain("id: ver1");
  });

  it("restores a version", async () => {
    const setup = makeSetup((url) => {
      if (url.includes("/versions/ver1/restore")) return json({ file: fileDto("f1") });
      return json({ error: { code: "NOT_FOUND" } }, 404);
    });
    withConfig({});
    const code = await runE2eeCommand(
      ["versions", "f1", "--restore", "ver1", "--config", setup.configPath],
      setup.ctx,
    );
    expect(code).toBe(0);
    expect(out(setup)).toContain("restored version ver1");
  });

  it("deletes a version", async () => {
    const setup = makeSetup((url) => {
      if (url.includes("/versions/ver1") && url.endsWith("/versions/ver1")) {
        return new Response(null, { status: 204 });
      }
      return json({ error: { code: "NOT_FOUND" } }, 404);
    });
    withConfig({});
    const code = await runE2eeCommand(
      ["versions", "f1", "--delete", "ver1", "--config", setup.configPath],
      setup.ctx,
    );
    expect(code).toBe(0);
    expect(out(setup)).toContain("deleted version ver1");
  });

  it("rejects using both --restore and --delete", async () => {
    const setup = makeSetup(() => json({}));
    withConfig({});
    await expect(
      runE2eeCommand(
        ["versions", "f1", "--restore", "ver1", "--delete", "ver2", "--config", setup.configPath],
        setup.ctx,
      ),
    ).rejects.toThrow(/not both/);
  });

  it("rejects unknown subcommand usage", async () => {
    const setup = makeSetup(() => json({}));
    await expect(
      runE2eeCommand(["versions", "--config", setup.configPath], setup.ctx),
    ).rejects.toThrow(/usage: omnicloud versions/);
  });
});

// ── login / logout ───────────────────────────────────────────────────────────

describe("login / logout", () => {
  it("validates the token before saving config at 0600", async () => {
    const setup = makeSetup(
      (url, init) => {
        if (url.endsWith("/api/tokens") && (init?.method ?? "GET") === "GET")
          return json({ tokens: [] });
        return json({ error: { code: "UNAUTHORIZED" } }, 401);
      },
      { answers: [TOKEN] },
    );
    const code = await runE2eeCommand(
      ["login", "--url", "http://cli.test", "--config", setup.configPath],
      setup.ctx,
    );
    expect(code).toBe(0);
    const saved = loadConfig(setup.configPath);
    expect(saved.token).toBe(TOKEN);
    expect(saved.url).toBe("http://cli.test");
    expect(statSync(setup.configPath).mode & 0o777).toBe(0o600);
  });

  it("rejects a too-short token without writing anything", async () => {
    const setup = makeSetup(() => json({}), { answers: ["short"] });
    await expect(
      runE2eeCommand(["login", "--config", setup.configPath], setup.ctx),
    ).rejects.toThrow(/at least 32 characters/);
    expect(existsSync(setup.configPath)).toBe(false);
  });

  it("logout removes the stored token", async () => {
    const setup = makeSetup(() => json({}));
    withConfig({});
    const code = await runE2eeCommand(["logout", "--config", setup.configPath], setup.ctx);
    expect(code).toBe(0);
    expect(loadConfig(setup.configPath).token).toBeUndefined();
    expect(out(setup)).toContain("revoke it in the web app");
  });
});

// ── dispatch ─────────────────────────────────────────────────────────────────

describe("command dispatch", () => {
  it("routes known commands and rejects unknown ones", async () => {
    const setup = makeSetup(() => json({}));
    await expect(runE2eeCommand(["nope"], setup.ctx)).rejects.toThrow(/Unknown command/);
    await expect(runE2eeCommand(["key"], setup.ctx)).rejects.toThrow(/key <generate\|status>/);
    await expect(runE2eeCommand(["recovery"], setup.ctx)).rejects.toThrow(
      /recovery <generate\|restore>/,
    );
  });

  it("leaves a bare migrate to the database-migration command", () => {
    // `omnicloud migrate` applies the database migrations; `omnicloud migrate
    // <fileId|all>` encrypts legacy plaintext files. The encryption dispatcher
    // runs first, so without this distinction the bare form was unreachable.
    expect(routesToE2ee("migrate")).toBe(false);
    expect(routesToE2ee("migrate", [])).toBe(false);
    expect(routesToE2ee("migrate", ["--env", "prod.env"])).toBe(false);
    expect(routesToE2ee("migrate", ["all"])).toBe(true);
    expect(routesToE2ee("migrate", ["file-1"])).toBe(true);
  });

  it("still routes the other encryption commands", () => {
    expect(isE2eeCommand("key")).toBe(true);
    expect(isE2eeCommand("recovery")).toBe(true);
    expect(isE2eeCommand("upload")).toBe(true);
    expect(isE2eeCommand("download")).toBe(true);
    expect(isE2eeCommand("versions")).toBe(true);
    expect(isE2eeCommand("login")).toBe(true);
    expect(isE2eeCommand("logout")).toBe(true);
    expect(isE2eeCommand("start")).toBe(false);
    expect(routesToE2ee("key")).toBe(true);
    expect(routesToE2ee("start")).toBe(false);
  });
});

// ── multipart helpers (local) ────────────────────────────────────────────────

interface MultipartPart {
  fieldName: string;
  filename: string | null;
  value: Buffer;
}

function parseMultipart(body: Uint8Array, boundary: string): MultipartPart[] {
  const raw = Buffer.from(body).toString("latin1");
  const out: MultipartPart[] = [];
  for (const segment of raw.split(`--${boundary}`)) {
    if (segment === "") continue;
    if (segment.startsWith("--")) break;
    if (!segment.startsWith("\r\n")) continue;
    const part = segment.slice(2).endsWith("\r\n") ? segment.slice(2, -2) : segment.slice(2);
    const splitAt = part.indexOf("\r\n\r\n");
    if (splitAt === -1) continue;
    const headers = part.slice(0, splitAt);
    out.push({
      fieldName: /name="([^"]*)"/.exec(headers)?.[1] ?? "",
      filename: /filename="([^"]*)"/.exec(headers)?.[1] ?? null,
      value: Buffer.from(part.slice(splitAt + 4), "latin1"),
    });
  }
  return out;
}

function fieldText(parts: MultipartPart[], name: string): string {
  const part = parts.find((p) => p.fieldName === name);
  if (!part) throw new Error(`multipart field "${name}" is missing`);
  return part.value.toString("utf8");
}
