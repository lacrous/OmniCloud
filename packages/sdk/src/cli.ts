import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = join(packageRoot, "server");
const schemaPath = join(serverDir, "prisma", "schema.prisma");
const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
  version: string;
};

const USAGE = `omnicloud ${pkg.version}

Usage:
  omnicloud                                    Start OmniCloud and open it in your browser
  omnicloud start [--no-open] [--env <file>]   Start the server (opens the browser unless --no-open)
  omnicloud migrate [--env <file>]              Apply database migrations
  omnicloud version                             Print the version
  omnicloud help                                Show this message

Migrations run automatically before the server starts. Configuration is read from
environment variables, then from a .env file in the current directory (or the file
given with --env). Variables already set in the environment are never overwritten.
See https://github.com/Lacrous/OmniCloud#configuration.
`;

interface ParsedArgs {
  command: string;
  migrate: boolean;
  envFile: string | null;
  open: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [first, ...rest] = argv;
  const command = first === undefined || first.startsWith("-") ? "start" : first;
  const options = first === undefined || first.startsWith("-") ? argv : rest;
  let migrate = false;
  let envFile: string | null = null;
  let open = true;
  for (let i = 0; i < options.length; i++) {
    const arg = options[i];
    if (arg === "--migrate") migrate = true;
    else if (arg === "--no-open") open = false;
    else if (arg === "--env") {
      const value = options[++i];
      if (!value) throw new Error("--env requires a file path");
      envFile = value;
    } else if (arg?.startsWith("--env=")) envFile = arg.slice("--env=".length);
    else throw new Error(`Unknown option: ${arg}`);
  }
  return { command, migrate, envFile, open };
}

export function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    let value = (match[2] ?? "").trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
    } else {
      const hash = value.search(/\s#/);
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    if (key) values[key] = value;
  }
  return values;
}

export function loadEnvFile(path: string, env: NodeJS.ProcessEnv): void {
  if (!existsSync(path)) return;
  for (const [key, value] of Object.entries(parseEnvFile(readFileSync(path, "utf8")))) {
    if (env[key] === undefined) env[key] = value;
  }
}

function prismaCli(): string {
  const require = createRequire(join(packageRoot, "package.json"));
  return require.resolve("prisma/build/index.js");
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env });
    child.on("error", reject);
    child.on("exit", (code, signal) => resolvePromise(signal ? 1 : (code ?? 1)));
  });
}

async function migrate(env: NodeJS.ProcessEnv): Promise<void> {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Add it to your environment or .env file.");
  }
  const code = await run(
    process.execPath,
    [prismaCli(), "migrate", "deploy", "--schema", schemaPath],
    env,
  );
  if (code !== 0) throw new Error(`Database migration failed (exit ${code}).`);
}

async function generate(env: NodeJS.ProcessEnv): Promise<void> {
  const code = await run(process.execPath, [prismaCli(), "generate", "--schema", schemaPath], env);
  if (code !== 0) throw new Error(`Prisma client generation failed (exit ${code}).`);
}

export function openerFor(
  platform: NodeJS.Platform,
  url: string,
): { command: string; args: string[] } {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32")
    return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  return { command: "xdg-open", args: [url] };
}

function openUrl(url: string): void {
  const opener = openerFor(process.platform, url);
  const child = spawn(opener.command, opener.args, { stdio: "ignore", detached: true });
  child.on("error", () => {
    process.stdout.write(`Open ${url} in your browser.\n`);
  });
  child.unref();
}

async function waitForServer(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      // not listening yet
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  return false;
}

function localUrl(env: NodeJS.ProcessEnv): string {
  const port = env.PORT && env.PORT.trim() !== "" ? env.PORT.trim() : "4000";
  const host =
    env.HOST && env.HOST.trim() !== "" && env.HOST.trim() !== "0.0.0.0"
      ? env.HOST.trim()
      : "127.0.0.1";
  return `http://${host}:${port}`;
}

async function start(args: ParsedArgs, env: NodeJS.ProcessEnv): Promise<void> {
  if (!existsSync(join(serverDir, "index.js"))) {
    throw new Error("The server bundle is missing. Reinstall @lacrous/omnicloud.");
  }
  await generate(env);
  await migrate(env);
  env.WEB_DIST_DIR ??= join(serverDir, "web");
  env.NODE_ENV ??= "production";

  const url = localUrl(env);
  const server = spawn(process.execPath, [join(serverDir, "index.js")], { stdio: "inherit", env });
  let exited = false;
  server.on("exit", () => {
    exited = true;
  });
  const forward = (signal: NodeJS.Signals) => () => {
    if (!exited) server.kill(signal);
  };
  process.on("SIGINT", forward("SIGINT"));
  process.on("SIGTERM", forward("SIGTERM"));

  if (args.open) {
    const ready = await waitForServer(`${url}/api/health`, 60_000);
    if (ready) {
      process.stdout.write(`\nOmniCloud is running at ${url}\n`);
      openUrl(url);
    } else if (!exited) {
      process.stdout.write(`\nOmniCloud did not answer at ${url} yet. Check the log above.\n`);
    }
  }

  await new Promise<void>((resolveExit, rejectExit) => {
    server.on("exit", (code, signal) => {
      if (signal) return resolveExit();
      if (code === 0 || code === null) return resolveExit();
      rejectExit(new Error(`Server exited with code ${code}.`));
    });
    server.on("error", rejectExit);
  });
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }

  if (args.command === "help" || args.command === "--help" || args.command === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (args.command === "version" || args.command === "--version" || args.command === "-v") {
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }

  const envPath = resolve(args.envFile ?? ".env");
  if (args.command === "start" && !existsSync(envPath) && !env.DATABASE_URL) {
    const outcome = await firstRunSetup(envPath);
    if (outcome === "not-interactive") {
      process.stderr.write(
        `omnicloud: no configuration found. Create ${envPath} (see https://github.com/Lacrous/OmniCloud#configuration) or run omnicloud in a terminal.\n`,
      );
      return 1;
    }
    if (outcome !== "saved") return 1;
  }

  loadEnvFile(envPath, env);

  try {
    if (args.command === "migrate") {
      await migrate(env);
      await generate(env);
      return 0;
    }
    if (args.command === "start") {
      await start(args, env);
      return 0;
    }
  } catch (error) {
    process.stderr.write(`omnicloud: ${(error as Error).message}\n`);
    return 1;
  }

  process.stderr.write(`Unknown command: ${args.command}\n\n${USAGE}`);
  return 2;
}

export function buildEnvFile(values: {
  databaseUrl: string;
  apiId: string;
  apiHash: string;
  encryptionKey: string;
}): string {
  return [
    "# Written by `omnicloud` on first run. Keep this file private.",
    `DATABASE_URL=${values.databaseUrl}`,
    `TELEGRAM_API_ID=${values.apiId}`,
    `TELEGRAM_API_HASH=${values.apiHash}`,
    `OMNICLOUD_ENCRYPTION_KEY=${values.encryptionKey}`,
    "",
  ].join("\n");
}

export function validateSetup(values: {
  databaseUrl: string;
  apiId: string;
  apiHash: string;
}): string | null {
  if (!/^postgres(ql)?:\/\/.+@.+\/.+$/.test(values.databaseUrl)) {
    return "DATABASE_URL must look like postgresql://user:password@host:5432/database";
  }
  if (!/^[1-9][0-9]*$/.test(values.apiId)) {
    return "TELEGRAM_API_ID must be the number shown at my.telegram.org";
  }
  if (!/^[0-9a-f]{32}$/i.test(values.apiHash)) {
    return "TELEGRAM_API_HASH must be the 32-character value shown at my.telegram.org";
  }
  return null;
}

type SetupOutcome = "saved" | "declined" | "invalid" | "not-interactive";

async function firstRunSetup(envPath: string): Promise<SetupOutcome> {
  if (!process.stdin.isTTY) return "not-interactive";

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write(
      "\nWelcome to OmniCloud. No .env file was found, so let's create one.\n\n" +
        "1. PostgreSQL database\n" +
        "   Format: postgresql://USER:PASSWORD@HOST:PORT/DATABASE\n" +
        "   The default docker setup uses postgresql://omnicloud:omnicloud@127.0.0.1:5432/omnicloud\n\n" +
        "2. Telegram API credentials\n" +
        "   Open https://my.telegram.org, log in, choose 'API development tools',\n" +
        "   and create an application. Copy the api_id and api_hash.\n\n",
    );

    const databaseUrl = (await rl.question("DATABASE_URL: ")).trim();
    const apiId = (await rl.question("TELEGRAM_API_ID: ")).trim();
    const apiHash = (await rl.question("TELEGRAM_API_HASH: ")).trim();

    const problem = validateSetup({ databaseUrl, apiId, apiHash });
    if (problem) {
      process.stderr.write(`\nomnicloud: ${problem}\nRun omnicloud again to retry.\n`);
      return "invalid";
    }

    const answer = (await rl.question(`\nSave these settings to ${envPath}? [Y/n] `))
      .trim()
      .toLowerCase();
    if (answer === "n" || answer === "no") {
      process.stdout.write("Nothing was saved.\n");
      return "declined";
    }

    writeFileSync(
      envPath,
      buildEnvFile({
        databaseUrl,
        apiId,
        apiHash,
        encryptionKey: randomBytes(32).toString("hex"),
      }),
      { mode: 0o600 },
    );
    chmodSync(envPath, 0o600);
    process.stdout.write(`Saved ${envPath}. A private encryption key was generated for you.\n\n`);
    return "saved";
  } finally {
    rl.close();
  }
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
