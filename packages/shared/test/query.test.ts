import { describe, expect, it } from "vitest";
import {
  MAX_PAGE_SIZE,
  normalizeLimit,
  normalizeOrder,
  normalizePage,
  normalizeSort,
  paginationMeta,
  parseSearchQuery,
  parseSize,
  parseSizeComparison,
} from "@omnicloud/shared";

describe("parseSize", () => {
  it("parses units case-insensitively", () => {
    expect(parseSize("1kb")).toBe(1024);
    expect(parseSize("1KB")).toBe(1024);
    expect(parseSize("1.5mb")).toBe(Math.round(1.5 * 1024 ** 2));
    expect(parseSize("2gb")).toBe(2 * 1024 ** 3);
    expect(parseSize("512")).toBe(512);
  });

  it("rejects nonsense", () => {
    expect(parseSize("abc")).toBeNull();
    expect(parseSize("1 lightyear")).toBeNull();
    expect(parseSize("-5mb")).toBeNull();
  });
});

describe("parseSizeComparison", () => {
  it("maps operators to bounds", () => {
    expect(parseSizeComparison(">100mb")).toEqual({ min: 100 * 1024 ** 2 + 1 });
    expect(parseSizeComparison(">=100mb")).toEqual({ min: 100 * 1024 ** 2 });
    expect(parseSizeComparison("<1kb")).toEqual({ max: 1023 });
    expect(parseSizeComparison("<=1kb")).toEqual({ max: 1024 });
    expect(parseSizeComparison("1kb")).toEqual({ min: 1024, max: 1024 });
  });

  it("returns null for unparseable input", () => {
    expect(parseSizeComparison(">nope")).toBeNull();
  });
});

describe("parseSearchQuery", () => {
  it("splits free text from structured filters", () => {
    const { query, freeText } = parseSearchQuery("report type:pdf size:>1mb starred:true");
    expect(freeText).toBe("report");
    expect(query.q).toBe("report");
    expect(query.type).toBe("pdf");
    expect(query.minSize).toBe(1024 ** 2 + 1);
    expect(query.starred).toBe(true);
  });

  it("maps trashed/deleted to status", () => {
    expect(parseSearchQuery("trashed:true").query.status).toBe("trashed");
    expect(parseSearchQuery("deleted:false").query.status).toBe("active");
  });

  it("parses date bounds as ISO strings", () => {
    const { query } = parseSearchQuery("after:2026-01-01 before:2026-02-01");
    expect(query.from).toBe("2026-01-01T00:00:00.000Z");
    expect(query.to).toBe("2026-02-01T23:59:59.999Z");
  });

  it("strips leading dots from extensions and lowercases", () => {
    expect(parseSearchQuery("ext:.PDF").query.ext).toBe("pdf");
  });

  it("keeps invalid structured values as literal terms", () => {
    const { query, freeText } = parseSearchQuery("size:huge starred:maybe");
    expect(query.minSize).toBeUndefined();
    expect(query.starred).toBeUndefined();
    expect(freeText).toBe("size:huge starred:maybe");
  });

  it("passes base query values through and lets tokens override", () => {
    const { query } = parseSearchQuery("type:image", { starred: true, status: "all" });
    expect(query.starred).toBe(true);
    expect(query.status).toBe("all");
    expect(query.type).toBe("image");
  });

  it("merges multiple bare terms into one substring search", () => {
    const { query } = parseSearchQuery("quarterly report final");
    expect(query.q).toBe("quarterly report final");
  });
});

describe("pagination helpers", () => {
  it("normalizes page and limit", () => {
    expect(normalizePage(undefined)).toBe(1);
    expect(normalizePage("0")).toBe(1);
    expect(normalizePage("-3")).toBe(1);
    expect(normalizePage("4")).toBe(4);
    expect(normalizeLimit(undefined)).toBe(50);
    expect(normalizeLimit("0")).toBe(50);
    expect(normalizeLimit("10")).toBe(10);
    expect(normalizeLimit(String(MAX_PAGE_SIZE + 500))).toBe(MAX_PAGE_SIZE);
  });

  it("normalizes sort and order", () => {
    expect(normalizeSort("name")).toBe("name");
    expect(normalizeSort("bogus")).toBeUndefined();
    expect(normalizeOrder("desc")).toBe("desc");
    expect(normalizeOrder("sideways")).toBeUndefined();
  });

  it("computes hasMore", () => {
    expect(paginationMeta(1, 10, 25)).toEqual({ page: 1, limit: 10, total: 25, hasMore: true });
    expect(paginationMeta(3, 10, 25).hasMore).toBe(false);
    expect(paginationMeta(1, 10, 10).hasMore).toBe(false);
  });
});
