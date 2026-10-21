import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { generateUrk, sha256Hex } from "@omnicloud/crypto";

/**
 * Configuration, prompts and key material handling for the `omnicloud` CLI.
 *
 * Secret-handling rules (roadmap rule 8 — secrets never argv, never env, never
 * logs): API tokens and root keys are accepted only from an interactive
 * muted-echo prompt or from files the user explicitly created at mode 0600.
 * Displaying a secret on screen always requires an explicit `--reveal` flag on
 * a TTY; there is no implicit echo anywhere.
 */

export interface CliConfig {
  /** OmniCloud server base URL (not secret). */
  url?: string;
  /** Personal API token (secret at rest; config file is written 0600). */
  token?: string;
  /** Path to a 0600 keyfile holding the URK (path is not secret). */
  keyfile?: string;
}

export function defaultConfigPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.trim() !== "") return join(xdg, "omnicloud", "config.json");
  return join(homedir(), ".config", "omnicloud", "config.json");
}

/** Reads the CLI config; a missing file yields an empty config. */
export function loadConfig(path: string): CliConfig {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as CliConfig;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Could not read config ${path}: ${(error as Error).message}`);
  }
}

/** Writes the CLI config at 0600 inside a 0700 directory (creates both). */
export function saveConfig(path: string, config: CliConfig): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function isTty(stream: { isTTY?: boolean }): boolean {
  return Boolean(stream.isTTY);
}

/**
 * Reads one line from the terminal with echo disabled (muted). Requires an
 * interactive TTY — scripts must use files instead of piping secrets.
 */
export async function mutedPrompt(question: string): Promise<string> {
  const stdin = process.stdin;
  const stdout = process.stdout;
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error(
      `${question.replace(/[:\s]+$/, "")} requires an interactive terminal; provide it through an explicit 0600 file instead`,
    );
  }
  stdout.write(question);
  return new Promise<string>((resolvePromise, reject) => {
    const wasRaw = stdin.isRaw ?? false;
    let buffer = "";
    const cleanup = () => {
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdin.removeListener("data", onData);
    };
    const onData = (chunk: string | Buffer) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const ch of text) {
        if (ch === "\u0003") {
          cleanup();
          stdout.write("\n");
          reject(new Error("cancelled"));
          return;
        }
        if (ch === "\r" || ch === "\n") {
          cleanup();
          stdout.write("\n");
          resolvePromise(buffer);
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          buffer = buffer.slice(0, -1);
          continue;
        }
        buffer += ch;
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
  });
}

/** Guards every on-screen secret: explicit flag AND an interactive TTY. */
export function requireReveal(
  reveal: boolean,
  what: string,
  stdoutTty: boolean = isTty(process.stdout),
): void {
  if (!reveal) {
    throw new Error(`${what} is displayed only with an explicit --reveal flag`);
  }
  if (!stdoutTty) {
    throw new Error(`${what} can only be shown on an interactive terminal`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Keyfile (explicit opt-in)
// ─────────────────────────────────────────────────────────────────────────────

interface KeyfileContents {
  version: 1;
  urkHex: string;
}

/**
 * Writes the URK to `path` at mode 0600 (parent dir 0700).
 *
 * Threat note: a keyfile stores the user's root key — and therefore the power
 * to decrypt every file — as plaintext bytes on this disk. It is an explicit
 * opt-in for machines where interactive entry is impractical. Anyone who can
 * read the file (malware, a compromised account, a stolen backup of $HOME)
 * gets the key. Prefer entering the key interactively or restoring it from a
 * recovery code on machines you do not fully control.
 */
export function writeKeyfile(path: string, urk: Uint8Array): void {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const contents: KeyfileContents = { version: 1, urkHex: bytesToHex(urk) };
  writeFileSync(target, `${JSON.stringify(contents, null, 2)}\n`, { mode: 0o600 });
  chmodSync(target, 0o600);
}

/** Reads a keyfile written by `writeKeyfile`; throws on anything malformed. */
export function readKeyfile(path: string): Uint8Array {
  const target = resolve(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(target, "utf8"));
  } catch (error) {
    throw new Error(`Could not read keyfile ${target}: ${(error as Error).message}`);
  }
  const contents = parsed as Partial<KeyfileContents>;
  if (contents?.version !== 1 || typeof contents.urkHex !== "string") {
    throw new Error(`Keyfile ${target} is not an omnicloud keyfile (expected version 1)`);
  }
  if (!/^[0-9a-f]{64}$/i.test(contents.urkHex)) {
    throw new Error(`Keyfile ${target} does not contain a 32-byte root key`);
  }
  try {
    const mode = statSync(target).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      process.stderr.write(
        `warning: keyfile ${target} is mode ${mode.toString(8)}; consider chmod 600 ${target}\n`,
      );
    }
  } catch {
    // stat failure is not fatal; the read already succeeded.
  }
  return hexToBytes(contents.urkHex);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(value: string): Uint8Array {
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Short public fingerprint of a key (safe to print; preimage infeasible). */
export function keyFingerprint(urk: Uint8Array): string {
  return sha256Hex(urk).slice(0, 16);
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolution of url / token / URK for commands
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolutionOptions {
  configPath: string;
  url?: string | undefined;
  keyfile?: string | undefined;
}

export function resolveUrl(options: ResolutionOptions): string {
  if (options.url && options.url.trim() !== "") return options.url.replace(/\/$/, "");
  const config = loadConfig(options.configPath);
  if (config.url && config.url.trim() !== "") return config.url.replace(/\/$/, "");
  return "http://127.0.0.1:4000";
}

export async function resolveToken(options: ResolutionOptions): Promise<string> {
  const config = loadConfig(options.configPath);
  if (config.token && config.token.length >= 32) return config.token;
  throw new Error(
    `No API token configured. Create one in the web app (Settings → API tokens), then run: omnicloud login  (config: ${options.configPath})`,
  );
}

/**
 * Resolves the URK: explicit --keyfile, then the config keyfile path, then a
 * muted interactive prompt. Never an environment variable, never argv.
 */
export async function resolveUrk(options: ResolutionOptions): Promise<Uint8Array> {
  const keyfilePath = options.keyfile ?? loadConfig(options.configPath).keyfile;
  if (keyfilePath && keyfilePath.trim() !== "") return readKeyfile(keyfilePath);
  const pasted = await mutedPrompt("Root key (64 hex chars): ");
  const hex = pasted.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error("A root key must be 64 hexadecimal characters (32 bytes)");
  }
  return hexToBytes(hex);
}

/** Same resolution order as resolveUrk, but without prompting (for status). */
export function resolveUrkFromFiles(options: ResolutionOptions): Uint8Array | null {
  const keyfilePath = options.keyfile ?? loadConfig(options.configPath).keyfile;
  if (keyfilePath && keyfilePath.trim() !== "") return readKeyfile(keyfilePath);
  return null;
}

/** Fresh URK for `key generate`. */
export function createUrk(): Uint8Array {
  return generateUrk();
}
