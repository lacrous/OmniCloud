/**
 * Single source of truth for the deployed origin.
 *
 * `VITE_SITE_URL` is inlined at build time by Vite (in both `index.html` via
 * `%VITE_SITE_URL%` and in this module via `import.meta.env`). Keeping the
 * fallback here means the build works with no environment configured, while a
 * custom domain is one variable change plus a rebuild.
 */
const FALLBACK_SITE_URL = "https://omnicloud-chi.vercel.app";

function normalizeSiteUrl(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  if (value === "") return FALLBACK_SITE_URL;
  // Drop trailing slashes so callers can always append "/path".
  return value.replace(/\/+$/, "");
}

export const SITE_URL: string = normalizeSiteUrl(import.meta.env.VITE_SITE_URL);
