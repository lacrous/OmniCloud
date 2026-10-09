import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sdkRoot = resolve(here, "..");
const repoRoot = resolve(sdkRoot, "../..");
const out = join(sdkRoot, "server");

const require = createRequire(join(sdkRoot, "package.json"));
const esbuild = require("esbuild");

const NPM_EXTERNALS = [
  "fastify",
  "@fastify/cookie",
  "@fastify/multipart",
  "@fastify/static",
  "@prisma/client",
  "prisma",
  "telegram",
  "big-integer",
];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await esbuild.build({
  entryPoints: [join(repoRoot, "apps/api/src/index.ts")],
  outfile: join(out, "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: NPM_EXTERNALS,
  banner: {
    js: 'import { createRequire as __omnicloudCreateRequire } from "node:module";\nconst require = __omnicloudCreateRequire(import.meta.url);',
  },
  logLevel: "warning",
});

const webDist = join(repoRoot, "apps/web/dist");
if (!existsSync(join(webDist, "index.html"))) {
  throw new Error("apps/web/dist is missing. Build the web app before bundling the server.");
}
cpSync(webDist, join(out, "web"), { recursive: true });

const dbPackage = join(repoRoot, "packages/database");
cpSync(join(dbPackage, "prisma"), join(out, "prisma"), { recursive: true });

console.log(`Bundled OmniCloud server into ${out}`);
