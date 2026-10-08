import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  sourcemap: true,
  clean: true,
  target: "es2022",
  // Bundle the internal workspace packages (they ship as TypeScript source);
  // keep the published runtime dependencies external.
  noExternal: [/^@omnicloud\//],
  external: ["telegram", "big-integer", "node:stream", "node:crypto"],
  // Inline the workspace packages' types into the bundled d.ts as well —
  // they are private and never published to npm. Node builtins must stay
  // external: the d.ts bundler does not know how to resolve them.
  dts: { resolve: true },
});
