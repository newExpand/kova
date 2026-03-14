/**
 * URL Link Provider Tests — regression tests for URL detection regex
 *
 * Key regression: commit 2151cd9 excluded non-ASCII chars (\u0080-\uFFFF)
 * from URL matching to prevent Korean/CJK/emoji from being included in URLs.
 */
import { describe, it, expect } from "vitest";
import { findUrls } from "../../src/features/terminal/links/urlLinkProvider";

describe("URL detection — findUrls", () => {
  it("should match simple http URL", () => {
    const results = findUrls("visit http://example.com for info");
    expect(results).toHaveLength(1);
    expect(results[0]!.url).toBe("http://example.com");
  });

  it("should match https URL with path", () => {
    const results = findUrls("https://example.com/path/to/page");
    expect(results).toHaveLength(1);
    expect(results[0]!.url).toBe("https://example.com/path/to/page");
  });

  it("should match URL with query parameters", () => {
    const results = findUrls("https://example.com?foo=bar&baz=qux");
    expect(results).toHaveLength(1);
    expect(results[0]!.url).toBe("https://example.com?foo=bar&baz=qux");
  });

  it("should strip trailing punctuation", () => {
    const results = findUrls("Check https://example.com.");
    expect(results).toHaveLength(1);
    expect(results[0]!.url).toBe("https://example.com");
  });

  it("should strip trailing comma and semicolon", () => {
    const r1 = findUrls("See https://a.com, and");
    expect(r1[0]!.url).toBe("https://a.com");

    const r2 = findUrls("See https://a.com;");
    expect(r2[0]!.url).toBe("https://a.com");
  });

  // ── 핵심 회귀 테스트 (commit 2151cd9) ────────────────────────────────
  it("should NOT include Korean characters in URL", () => {
    const results = findUrls("https://example.com/path한글이후");
    expect(results).toHaveLength(1);
    // URL should stop before Korean characters
    expect(results[0]!.url).toBe("https://example.com/path");
  });

  it("should NOT include CJK characters in URL", () => {
    const results = findUrls("https://example.com/path中文");
    expect(results).toHaveLength(1);
    expect(results[0]!.url).toBe("https://example.com/path");
  });

  it("should NOT include emoji in URL", () => {
    // Emoji like 🎉 are U+1F389 (above BMP), covered by \u0080-\uFFFF
    // plus surrogate pair handling
    const results = findUrls("https://example.com/path🎉");
    expect(results).toHaveLength(1);
    expect(results[0]!.url).toBe("https://example.com/path");
  });

  it("should match multiple URLs in one line", () => {
    const results = findUrls("first https://a.com then https://b.com end");
    expect(results).toHaveLength(2);
    expect(results[0]!.url).toBe("https://a.com");
    expect(results[1]!.url).toBe("https://b.com");
  });

  it("should not match ftp:// or other protocols", () => {
    const results = findUrls("ftp://example.com");
    expect(results).toHaveLength(0);
  });

  it("should not match bare domains without protocol", () => {
    const results = findUrls("example.com is a domain");
    expect(results).toHaveLength(0);
  });

  it("should handle URL surrounded by quotes", () => {
    const results = findUrls('visit "https://example.com" now');
    expect(results).toHaveLength(1);
    expect(results[0]!.url).toBe("https://example.com");
  });

  it("should handle URL in parentheses", () => {
    const results = findUrls("(https://example.com)");
    expect(results).toHaveLength(1);
    expect(results[0]!.url).toBe("https://example.com");
  });

  it("should return empty for text without URLs", () => {
    const results = findUrls("no urls here");
    expect(results).toHaveLength(0);
  });

  it("should correctly track startIdx and endIdx", () => {
    const text = "go to https://x.com ok";
    const results = findUrls(text);
    expect(results).toHaveLength(1);
    expect(results[0]!.startIdx).toBe(6); // "go to " = 6 chars
    expect(text.slice(results[0]!.startIdx, results[0]!.endIdx)).toBe("https://x.com");
  });
});
