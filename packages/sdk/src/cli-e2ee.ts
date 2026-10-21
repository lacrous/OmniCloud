import { stat, writeFile } from "node:fs/promises";
import { basename, resolve as resolvePath } from "node:path";
import {
  ENCRYPTION_FORMAT,
  createRecoveryBlob,
  generateRecoveryCode,
  openRecoveryBlob,
  parseRecoveryCode,
} from "@omnicloud/crypto";
import { OmniCloudClient } from "./client";
import {
  bytesToHex,
  createUrk,
  defaultConfigPath,
  isTty,
  keyFingerprint,
  loadConfig,
  mutedPrompt,
  readKeyfile,
  requireReveal,
  resolveToken,
  resolveUrl,
  resolveUrk,
  saveConfig,
  writeKeyfile,
} from "./cli-auth";
import type { ResolutionOptions } from "./cli-auth";
import {
  downloadDecryptedToFile,
  migrateFile,
  uploadEncrypted,
  uploadEncryptedStream,
} from "./encryption";

/**
 * `omnicloud` CLI commands for end-to-end encryption (roadmap Phase 6).
 *
 * Invariants:
 * - An upload without `--encrypt` does not exist: there is no plaintext path.
 * - Downloading with `--decrypt` refuses non-OCE1 files (no silent fallback).
 * - Secrets (URK, recovery codes, API tokens) come from 0600 files or muted
 *   prompts only — never argv, never environment, never logs.
 * - On-screen secrets require an explicit `--reveal` on an interactive TTY.
 */

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
  /** Muted-echo line prompt (interactive TTY only). */
  prompt(question: string): Promise<string>;
  /** Whether stdout is an interactive terminal. */
  stdoutTty(): boolean;
}

export interface CliContext {
  io: CliIo;
  /** Client factory; tests inject their own. */
  createClient(options: { baseUrl: string; token?: string }): OmniCloudClient;
}

export function defaultIo(): CliIo {
  return {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    prompt: mutedPrompt,
    stdoutTty: () => isTty(process.stdout),
  };
}

export function defaultCreateClient(options: { baseUrl: string; token?: string }): OmniCloudClient {
  return new OmniCloudClient(options);
}

// ─────────────────────────────────────────────────────────────────────────────
// Argument parsing (per-command; secrets never accepted as values)
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedArgs {
  positionals: string[];
  values: Record<string, string>;
  flags: Record<string, true>;
}

function toKey(option: string): string {
  return option.replace(/^--?/, "").replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function parseCommandArgs(
  argv: string[],
  valueOptions: string[],
  flagOptions: string[],
): ParsedArgs {
  const out: ParsedArgs = { positionals: [], values: {}, flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]!;
    let name = raw;
    let inline: string | null = null;
    if (raw.startsWith("--") && raw.includes("=")) {
      const eq = raw.indexOf("=");
      name = raw.slice(0, eq);
      inline = raw.slice(eq + 1);
    }
    if (valueOptions.includes(name)) {
      const value = inline ?? argv[++i];
      if (value === undefined) throw new Error(`${name} requires a value`);
      out.values[toKey(name)] = value;
    } else if (flagOptions.includes(name)) {
      out.flags[toKey(name)] = true;
    } else if (raw.startsWith("-") && raw.length > 1 && !raw.startsWith("--")) {
      // Single-dash short options (-o path, -o=path).
      const short = raw.length > 2 && raw[2] === "=" ? `-${raw[1]}` : `-${raw[1]}`;
      const shortInline = raw.length > 2 && raw[2] === "=" ? raw.slice(3) : null;
      if (valueOptions.includes(short)) {
        const value = shortInline ?? argv[++i];
        if (value === undefined) throw new Error(`${short} requires a value`);
        out.values[toKey(short)] = value;
      } else if (flagOptions.includes(short)) {
        out.flags[toKey(short)] = true;
      } else {
        throw new Error(`Unknown option: ${raw}`);
      }
    } else {
      out.positionals.push(raw);
    }
  }
  return out;
}

function commonOptions(parsed: ParsedArgs): ResolutionOptions & { reveal: boolean } {
  return {
    configPath: parsed.values.config ?? defaultConfigPath(),
    url: parsed.values.url,
    keyfile: parsed.values.keyfile,
    reveal: parsed.flags.reveal === true,
  };
}

const COMMON_VALUES = ["--config", "--url", "--keyfile"];
const COMMON_FLAGS = ["--reveal"];

// The options that may follow a bare `migrate`. `--env` belongs to the
// database-migration command, the rest to the encryption commands.
const MIGRATE_VALUE_OPTIONS = [...COMMON_VALUES, "--env"];
const MIGRATE_FLAG_OPTIONS = [...COMMON_FLAGS];

// ─────────────────────────────────────────────────────────────────────────────
// key generate / key status
// ─────────────────────────────────────────────────────────────────────────────

export async function runKeyGenerate(argv: string[], ctx: CliContext): Promise<number> {
  const parsed = parseCommandArgs(argv, COMMON_VALUES, COMMON_FLAGS);
  if (parsed.positionals.length > 0) {
    throw new Error("usage: omnicloud key generate [--keyfile <path>] [--reveal]");
  }
  const options = commonOptions(parsed);
  const keyfile = options.keyfile;
  const wantPersist = Boolean(keyfile && keyfile.trim() !== "");
  if (!wantPersist && !options.reveal) {
    throw new Error(
      "key generate needs an explicit destination: --keyfile <path> (persisted at mode 600) or --reveal (printed once on this terminal)",
    );
  }
  if (options.reveal) requireReveal(true, "A new root key", ctx.io.stdoutTty());

  const urk = createUrk();
  const fingerprint = keyFingerprint(urk);
  if (wantPersist) {
    writeKeyfile(keyfile!, urk);
    ctx.io.out(
      `Root key written to ${resolvePath(keyfile!)} (mode 600).\n` +
        `Fingerprint: ${fingerprint}\n` +
        `warning: anyone who can read this file can decrypt your files.\n`,
    );
  }
  if (options.reveal) {
    // requireReveal already verified --reveal + TTY above.
    ctx.io.out(
      `Root key (${bytesToHex(urk)})\n` +
        `Fingerprint: ${fingerprint}\n` +
        `Record it now — this key is shown only once and is never printed again.\n`,
    );
  }
  if (ctx.io.stdoutTty() || wantPersist) {
    ctx.io.out("Next: store a backup with `omnicloud recovery generate --reveal`.\n");
  }
  return 0;
}

export async function runKeyStatus(argv: string[], ctx: CliContext): Promise<number> {
  const parsed = parseCommandArgs(argv, COMMON_VALUES, COMMON_FLAGS);
  if (parsed.positionals.length > 0) {
    throw new Error("usage: omnicloud key status [--keyfile <path>] [--reveal]");
  }
  const options = commonOptions(parsed);
  const keyfilePath = options.keyfile ?? loadConfig(options.configPath).keyfile;
  if (!keyfilePath || keyfilePath.trim() === "") {
    ctx.io.out(
      "No keyfile configured.\n" +
        "Keys are entered at a muted prompt or restored with `omnicloud recovery restore`.\n" +
        `Config: ${options.configPath}\n`,
    );
    return 0;
  }
  const urk = readKeyfile(keyfilePath);
  ctx.io.out(`Keyfile: ${resolvePath(keyfilePath)}\nFingerprint: ${keyFingerprint(urk)}\n`);
  if (options.reveal) {
    requireReveal(true, "The root key", ctx.io.stdoutTty());
    ctx.io.out(`Root key: ${bytesToHex(urk)}\n`);
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// recovery generate / recovery restore
// ─────────────────────────────────────────────────────────────────────────────

function toBase64(bytes: Uint8Array): string {
  const BufferCtor = (globalThis as { Buffer?: typeof Buffer }).Buffer;
  if (BufferCtor) return BufferCtor.from(bytes).toString("base64");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const BufferCtor = (globalThis as { Buffer?: typeof Buffer }).Buffer;
  if (BufferCtor) return new Uint8Array(BufferCtor.from(value, "base64"));
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export async function runRecoveryGenerate(argv: string[], ctx: CliContext): Promise<number> {
  const parsed = parseCommandArgs(argv, COMMON_VALUES, COMMON_FLAGS);
  if (parsed.positionals.length > 0) {
    throw new Error("usage: omnicloud recovery generate [--keyfile <path>] [--reveal]");
  }
  const options = commonOptions(parsed);
  // Validate BEFORE mutating the stored record: a code the user cannot see
  // would destroy the previous recovery record for nothing.
  requireReveal(options.reveal, "The new recovery code", ctx.io.stdoutTty());

  const urk = await resolveUrk(options);
  const token = await resolveToken(options);
  const client = ctx.createClient({ baseUrl: resolveUrl(options), token });

  const code = generateRecoveryCode();
  const blob = createRecoveryBlob(urk, code.bytes);
  await client.auth.setRecoveryBlob(toBase64(blob));

  ctx.io.out(
    "Recovery record stored on the server (opaque ciphertext; the code never leaves this terminal).\n" +
      `Recovery code: ${code.code}\n` +
      "Write the code down now — it is shown only once. Without it the stored record is useless, and the server cannot reset it for you.\n",
  );
  return 0;
}

export async function runRecoveryRestore(argv: string[], ctx: CliContext): Promise<number> {
  const parsed = parseCommandArgs(argv, COMMON_VALUES, COMMON_FLAGS);
  if (parsed.positionals.length > 0) {
    throw new Error("usage: omnicloud recovery restore [--keyfile <path>] | [--reveal]");
  }
  const options = commonOptions(parsed);
  const keyfile = options.keyfile;
  const wantPersist = Boolean(keyfile && keyfile.trim() !== "");
  if (!wantPersist && !options.reveal) {
    throw new Error(
      "recovery restore needs an explicit destination: --keyfile <path> (persisted at mode 600) or --reveal (printed once on this terminal)",
    );
  }

  const token = await resolveToken(options);
  const client = ctx.createClient({ baseUrl: resolveUrl(options), token });
  const { recoveryBlob } = await client.auth.getRecoveryBlob();
  if (!recoveryBlob) {
    ctx.io.err(
      "No recovery record is stored for this account. Create one with `omnicloud recovery generate --reveal`.\n",
    );
    return 1;
  }

  const pasted = await ctx.io.prompt("Recovery code: ");
  let urk: Uint8Array;
  try {
    urk = openRecoveryBlob(fromBase64(recoveryBlob), parseRecoveryCode(pasted));
  } catch {
    ctx.io.err("Recovery failed: the code is incorrect or the stored record is damaged.\n");
    return 1;
  }

  const fingerprint = keyFingerprint(urk);
  if (wantPersist) {
    writeKeyfile(keyfile!, urk);
    ctx.io.out(
      `Root key restored to ${resolvePath(keyfile!)} (mode 600).\nFingerprint: ${fingerprint}\n`,
    );
  } else {
    requireReveal(true, "The root key", ctx.io.stdoutTty());
    ctx.io.out(`Root key: ${bytesToHex(urk)}\nFingerprint: ${fingerprint}\n`);
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// upload / download / migrate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Files at or above this size take the streaming path: chunked encryption to
 * a 0600 spool file and a disk-backed multipart body, so peak memory stays
 * bounded by the chunk size rather than the file size. Smaller files keep the
 * simple in-memory path (identical wire format).
 */
export const STREAM_UPLOAD_THRESHOLD = 8 * 1024 * 1024;

export async function runUpload(argv: string[], ctx: CliContext): Promise<number> {
  const parsed = parseCommandArgs(argv, [...COMMON_VALUES, "--folder"], ["--encrypt"]);
  if (parsed.positionals.length !== 1) {
    throw new Error("usage: omnicloud upload <path> --encrypt [--folder <id>]");
  }
  if (parsed.flags.encrypt !== true) {
    throw new Error(
      "omnicloud upload always encrypts client-side — pass --encrypt. There is no plaintext upload path.",
    );
  }
  const options = commonOptions(parsed);
  const urk = await resolveUrk(options);
  const token = await resolveToken(options);
  const client = ctx.createClient({ baseUrl: resolveUrl(options), token });

  const path = parsed.positionals[0]!;
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`${path} is not a regular file`);
  const name = basename(path);
  const folderId = parsed.values.folder ?? null;
  const uploadOptions = { name, urk, ...(folderId ? { folderId } : {}) };

  const result =
    info.size >= STREAM_UPLOAD_THRESHOLD
      ? await uploadEncryptedStream(client, path, uploadOptions)
      : await uploadEncrypted(client, { path }, uploadOptions);
  ctx.io.out(
    `Uploaded ${name} (${info.size} bytes, ${ENCRYPTION_FORMAT} encrypted${info.size >= STREAM_UPLOAD_THRESHOLD ? ", streamed" : ""}) → file ${result.fileId}\n`,
  );
  return 0;
}

function safeOutputName(name: string): string {
  const cleaned = basename(name.replace(/\\/g, "/"))
    .replace(/[/\\:*?"<>|]/g, "_")
    .trim();
  return cleaned === "" || cleaned === "." || cleaned === ".." ? "" : cleaned;
}

export async function runDownload(argv: string[], ctx: CliContext): Promise<number> {
  const parsed = parseCommandArgs(argv, [...COMMON_VALUES, "-o", "--output"], ["--decrypt"]);
  if (parsed.positionals.length !== 1) {
    throw new Error("usage: omnicloud download <id> [--decrypt] [-o <path>]");
  }
  const options = commonOptions(parsed);
  const id = parsed.positionals[0]!;
  const token = await resolveToken(options);
  const client = ctx.createClient({ baseUrl: resolveUrl(options), token });
  const output = parsed.values.output ?? parsed.values.o ?? null;

  if (parsed.flags.decrypt === true) {
    // Check the format BEFORE asking for key material, so a legacy file fails
    // fast instead of after the user has typed a secret.
    const meta = await client.files.get(id);
    if ((meta.encryptionFormat ?? null) !== "OCE1") {
      const seen = meta.encryptionFormat ?? null;
      throw new Error(
        seen === null
          ? `File ${id} is not encrypted (stored as plaintext); --decrypt only opens OCE1-encrypted files. Migrate it first: omnicloud migrate ${id}`
          : `File ${id} has unsupported encryptionFormat "${seen}"; --decrypt only opens OCE1-encrypted files`,
      );
    }
    const urk = await resolveUrk(options);
    const targetPath = output !== null ? resolvePath(output) : null;
    const result = await downloadDecryptedToFile(client, id, {
      urk,
      ...(targetPath !== null
        ? { targetPath }
        : {
            resolveTarget: (metadata) => {
              const name = safeOutputName(metadata.name);
              if (name === "") {
                throw new Error(
                  "The decrypted filename is empty or unsafe; pass an explicit destination with -o <path>",
                );
              }
              return resolvePath(name);
            },
          }),
    });
    ctx.io.out(
      `Decrypted ${result.metadata.name} → ${result.path} (${result.bytes} bytes, sha256 ${result.sha256.slice(0, 16)}…)\n`,
    );
    return 0;
  }

  const target = output ?? `./${id}.bin`;
  const targetPath = resolvePath(target);
  const download = await client.requestBinary(`/api/files/${id}/download`);
  await writeFile(targetPath, download.data);
  ctx.io.out(
    `Downloaded stored bytes → ${targetPath} (${download.data.byteLength} bytes)\n` +
      `note: for an ${ENCRYPTION_FORMAT} file these bytes are ciphertext; add --decrypt to open it.\n`,
  );
  return 0;
}

export async function runMigrate(argv: string[], ctx: CliContext): Promise<number> {
  const parsed = parseCommandArgs(argv, COMMON_VALUES, []);
  if (parsed.positionals.length !== 1) {
    throw new Error("usage: omnicloud migrate <fileId|all>");
  }
  const options = commonOptions(parsed);
  const urk = await resolveUrk(options);
  const token = await resolveToken(options);
  const client = ctx.createClient({ baseUrl: resolveUrl(options), token });
  const target = parsed.positionals[0]!;

  const migrateOne = async (id: string, name?: string): Promise<MigrateOutcome> => {
    const label = name ? `${name} (${id})` : id;
    try {
      const result = await migrateFile(client, id, { urk });
      const detail =
        result.status === "migrated_with_plaintext_history"
          ? `kept ${result.plaintextVersionsRemaining} plaintext version(s) in history`
          : result.status;
      ctx.io.out(`migrated ${label}: ${detail}\n`);
      return { id, status: result.status, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.io.err(`FAILED ${label}: ${message}\n`);
      return { id, status: "failed", error: message };
    }
  };

  if (target !== "all") {
    const outcome = await migrateOne(target);
    return outcome.status === "failed" ? 1 : 0;
  }

  // Enumerate every active (non-trashed) legacy file, page by page.
  const legacy: { id: string; name: string }[] = [];
  for (let page = 1; page <= 10_000; page++) {
    const batch = await client.files.list({ page, limit: 100 });
    for (const file of batch.files) {
      if (!file.trashed && (file.encryptionFormat ?? null) === null) {
        legacy.push({ id: file.id, name: file.name });
      }
    }
    if (batch.files.length < 100 || !batch.pagination.hasMore) break;
  }

  if (legacy.length === 0) {
    ctx.io.out("No plaintext files found — nothing to migrate.\n");
    return 0;
  }

  ctx.io.out(`Migrating ${legacy.length} plaintext file(s)...\n`);
  let migrated = 0;
  let already = 0;
  let history = 0;
  let failed = 0;
  for (const file of legacy) {
    const outcome = await migrateOne(file.id, file.name);
    if (outcome.status === "migrated") migrated += 1;
    else if (outcome.status === "already_migrated") already += 1;
    else if (outcome.status === "migrated_with_plaintext_history") history += 1;
    else failed += 1;
  }
  ctx.io.out(
    `done: ${migrated} migrated, ${history} migrated (plaintext history kept), ${already} already encrypted, ${failed} failed\n`,
  );
  return failed > 0 ? 1 : 0;
}

interface MigrateOutcome {
  id: string;
  status: "migrated" | "migrated_with_plaintext_history" | "already_migrated" | "failed";
  error: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// versions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lists a file's versions and can restore or delete one.
 *
 *   omnicloud versions <fileId>
 *   omnicloud versions <fileId> --restore <versionId>
 *   omnicloud versions <fileId> --delete <versionId>
 */
export async function runVersions(argv: string[], ctx: CliContext): Promise<number> {
  const parsed = parseCommandArgs(argv, [...COMMON_VALUES, "--restore", "--delete"], COMMON_FLAGS);
  if (parsed.positionals.length !== 1) {
    throw new Error(
      "usage: omnicloud versions <fileId> [--restore <versionId>|--delete <versionId>]",
    );
  }
  const options = commonOptions(parsed);
  const token = await resolveToken(options);
  const client = ctx.createClient({ baseUrl: resolveUrl(options), token });
  const fileId = parsed.positionals[0]!;

  const restoreId = parsed.values.restore;
  const deleteId = parsed.values.delete;
  if (restoreId !== undefined && deleteId !== undefined) {
    throw new Error("use either --restore or --delete, not both");
  }

  if (restoreId !== undefined) {
    const file = await client.files.restoreVersion(fileId, restoreId);
    ctx.io.out(`restored version ${restoreId} of ${file.name}\n`);
    return 0;
  }
  if (deleteId !== undefined) {
    await client.files.deleteVersion(fileId, deleteId);
    ctx.io.out(`deleted version ${deleteId}\n`);
    return 0;
  }

  const file = await client.files.get(fileId);
  const versions = await client.files.versions(fileId);
  ctx.io.out(`${file.name} — ${versions.length} version(s)\n`);
  for (const version of versions) {
    const marker = version.isCurrent ? " (current)" : "";
    ctx.io.out(
      `  v${version.versionNumber}  ${version.size} bytes  ${version.createdAt}${marker}\n`,
    );
    ctx.io.out(`      id: ${version.id}\n`);
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// login / logout
// ─────────────────────────────────────────────────────────────────────────────

export async function runLogin(argv: string[], ctx: CliContext): Promise<number> {
  const parsed = parseCommandArgs(argv, ["--config", "--url"], []);
  if (parsed.positionals.length > 0) {
    throw new Error("usage: omnicloud login [--url <baseUrl>]");
  }
  const configPath = parsed.values.config ?? defaultConfigPath();
  const url = parsed.values.url ?? loadConfig(configPath).url ?? "http://127.0.0.1:4000";
  const token = (await ctx.io.prompt("API token (paste from the web app): ")).trim();
  if (token.length < 32) {
    throw new Error(
      "An API token is at least 32 characters; create one in the web app (Settings → API tokens)",
    );
  }
  const client = ctx.createClient({ baseUrl: url.replace(/\/$/, ""), token });
  // GET /api/tokens authenticates through the bearer hook, so this proves the
  // token works before anything is written to disk.
  await client.request("GET", "/api/tokens");

  const existing = loadConfig(configPath);
  saveConfig(configPath, { ...existing, url: url.replace(/\/$/, ""), token });
  ctx.io.out(`Signed in to ${url.replace(/\/$/, "")}. Config saved at ${configPath} (mode 600).\n`);
  return 0;
}

export async function runLogout(argv: string[], ctx: CliContext): Promise<number> {
  const parsed = parseCommandArgs(argv, ["--config"], []);
  if (parsed.positionals.length > 0) throw new Error("usage: omnicloud logout");
  const configPath = parsed.values.config ?? defaultConfigPath();
  const existing = loadConfig(configPath);
  if (!existing.token) {
    ctx.io.out("No API token in the config; nothing to do.\n");
    return 0;
  }
  saveConfig(configPath, { ...existing, token: undefined });
  ctx.io.out(
    `Removed the stored token from ${configPath}.\n` +
      "note: the token itself stays valid server-side until you revoke it in the web app (Settings → API tokens).\n",
  );
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch
// ─────────────────────────────────────────────────────────────────────────────

const COMMANDS: Record<string, (argv: string[], ctx: CliContext) => Promise<number>> = {
  key: async (argv, ctx) => {
    const [sub, ...rest] = argv;
    if (sub === "generate") return runKeyGenerate(rest, ctx);
    if (sub === "status") return runKeyStatus(rest, ctx);
    throw new Error("usage: omnicloud key <generate|status>");
  },
  recovery: async (argv, ctx) => {
    const [sub, ...rest] = argv;
    if (sub === "generate") return runRecoveryGenerate(rest, ctx);
    if (sub === "restore") return runRecoveryRestore(rest, ctx);
    throw new Error("usage: omnicloud recovery <generate|restore>");
  },
  upload: runUpload,
  download: runDownload,
  migrate: runMigrate,
  versions: runVersions,
  login: runLogin,
  logout: runLogout,
};

/** Whether `command` is one of the encryption commands. */
export function isE2eeCommand(command: string): boolean {
  return Object.hasOwn(COMMANDS, command);
}

/**
 * Whether a command line should be handled by the encryption dispatcher.
 *
 * `migrate` is ambiguous: bare, it applies the database migrations, and with a
 * file id (or `all`) it encrypts legacy plaintext files. Only a positional
 * target makes it the encryption command — otherwise the bare form would be
 * unreachable, because the encryption dispatcher runs first.
 */
export function routesToE2ee(command: string, args: string[] = []): boolean {
  if (!isE2eeCommand(command)) return false;
  if (command === "migrate") return hasPositionalTarget(args);
  return true;
}

/** True when the arguments contain a bare word, rather than only options. */
function hasPositionalTarget(args: string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const raw = args[i]!;
    const eq = raw.indexOf("=");
    const name = raw.startsWith("--") && eq !== -1 ? raw.slice(0, eq) : raw;
    if (MIGRATE_VALUE_OPTIONS.includes(name)) {
      i++;
      continue;
    }
    if (MIGRATE_FLAG_OPTIONS.includes(name)) continue;
    if (!raw.startsWith("-")) return true;
  }
  return false;
}

export async function runE2eeCommand(
  argv: string[],
  ctx: CliContext = { io: defaultIo(), createClient: defaultCreateClient },
): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || !isE2eeCommand(command)) {
    throw new Error(`Unknown command: ${command ?? ""}`);
  }
  return COMMANDS[command]!(rest, ctx);
}
