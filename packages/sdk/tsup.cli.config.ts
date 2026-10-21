import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  clean: false,
  dts: false,
  sourcemap: false,
  // The workspace packages ship as TypeScript source — inline them so the
  // published bin never tries to import "@omnicloud/*" at runtime.
  noExternal: [/^@omnicloud\//],
  banner: { js: "#!/usr/bin/env node" },
});
