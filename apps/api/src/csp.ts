import { createHash } from "node:crypto";

/**
 * Content-Security-Policy for the served web app. Inline scripts and styles are
 * allowed only by SHA-256 hash, so an injected inline script (for example from a
 * malicious file name rendered by the UI) does not match and is blocked. No
 * `unsafe-inline` and no `unsafe-eval`.
 */
export function sha256Source(content: string): string {
  return `'sha256-${createHash("sha256").update(content, "utf8").digest("base64")}'`;
}

export function buildContentSecurityPolicy(
  inlineScripts: string[],
  inlineStyles: string[],
): string {
  const scriptSources = ["'self'", ...inlineScripts.map(sha256Source)];
  const styleSources = ["'self'", ...inlineStyles.map(sha256Source)];
  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    `style-src ${styleSources.join(" ")}`,
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Extracts inline script and style bodies from an HTML document. */
export function inlineBlocks(html: string): { scripts: string[]; styles: string[] } {
  const scripts: string[] = [];
  const styles: string[] = [];
  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    scripts.push(match[1]!);
  }
  for (const match of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    styles.push(match[1]!);
  }
  return { scripts, styles };
}
