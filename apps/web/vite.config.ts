import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import type { Plugin } from "vite";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_SITE_URL = "https://omnicloud-chi.vercel.app";

/**
 * Rewrites the origin in the built `index.html` and regenerates the SEO files
 * that live in `public/` (which Vite copies verbatim and never substitutes).
 *
 * A plugin is used rather than Vite's `%VITE_*%` HTML substitution because
 * that leaves the literal placeholder in the output when the variable is
 * unset, and because `public/` files are outside its reach entirely.
 */
function siteOrigin(siteUrl: string): Plugin {
  return {
    name: "omnicloud-site-origin",
    apply: "build",
    // index.html is the entry and is emitted after generateBundle, so it must be
    // rewritten here rather than by walking the bundle.
    transformIndexHtml(html) {
      return html.replaceAll(DEFAULT_SITE_URL, siteUrl);
    },
    // public/ assets (robots.txt, sitemap.xml) are copied verbatim and are never
    // substituted, so they are (re)written once the output directory exists.
    closeBundle() {
      const outDir = resolve(__dirname, "dist");
      writeFileSync(
        resolve(outDir, "robots.txt"),
        `User-agent: *
Allow: /
Disallow: /drive
Disallow: /recent
Disallow: /starred
Disallow: /trash
Disallow: /storage
Disallow: /settings

Sitemap: ${siteUrl}/sitemap.xml
`,
      );
      writeFileSync(
        resolve(outDir, "sitemap.xml"),
        `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${siteUrl}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${siteUrl}/login</loc>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
</urlset>
`,
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const siteUrl = (env.VITE_SITE_URL ?? "").trim().replace(/\/+$/, "") || DEFAULT_SITE_URL;
  return {
    plugins: [react(), tailwindcss(), siteOrigin(siteUrl)],
    server: {
      port: Number(process.env.WEB_PORT ?? 5173),
      proxy: {
        "/api": {
          target: `http://localhost:${process.env.API_PORT ?? 4000}`,
          changeOrigin: false,
        },
      },
    },
  };
});
