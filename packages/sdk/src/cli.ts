import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = join(packageRoot, "server");
const schemaPath = join(serverDir, "prisma", "schema.prisma");
const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
  version: string;
};

const USAGE = `omnicloud ${pkg.version}

Usage:
  omnicloud start [--migrate] [--env <file>]   Run the OmniCloud server
  omnicloud migrate [--env <file>]              Apply database migrations
  omnicloud version                             Print the version
  omnicloud help                                Show this message

Configuration is read from environment variables, then from a .env file in the
current directory (or the file given with --env). Variables already set in the
environment are never overwritten. See https://github.com/Lacrous/OmniCloud#configuration.
`;

interface ParsedArgs {
  command: string;
  migrate: boolean;
  envFile: string | null;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  let migrate = false;
  let envFile: string | null = null;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--migrate") migrate = true;
    else if (arg === "--env") {
      const value = rest[++i];
      if (!value) throw new Error("--env requires a file path");
      envFile = value;
    } else if (arg?.startsWith("--env=")) envFile = arg.slice("--env=".length);
    else throw new Error(`Unknown option: ${arg}`);
  }
  return { command, migrate, envFile };
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

async function start(args: ParsedArgs, env: NodeJS.ProcessEnv): Promise<void> {
  if (!existsSync(join(serverDir, "index.js"))) {
    throw new Error("The server bundle is missing. Reinstall @lacrous/omnicloud.");
  }
  await generate(env);
  if (args.migrate) await migrate(env);
  env.WEB_DIST_DIR ??= join(serverDir, "web");
  env.NODE_ENV ??= "production";
  const code = await run(process.execPath, [join(serverDir, "index.js")], env);
  if (code !== 0) throw new Error(`Server exited with code ${code}.`);
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

  loadEnvFile(resolve(args.envFile ?? ".env"), env);

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
