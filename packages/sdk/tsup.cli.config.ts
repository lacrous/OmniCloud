import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  clean: false,
  dts: false,
  sourcemap: false,
  banner: { js: "#!/usr/bin/env node" },
});
