import { describe, expect, it } from "vitest";
import {
  buildAccountDashboardUrl,
  buildTokenPermissionText,
  buildWranglerEnvSnippet,
  calculateReleaseReadiness,
  filterStudioCommands,
  formatRelativeAge,
  getCacheFreshness,
} from "@/lib/studio";

describe("studio helpers", () => {
  it("formats relative cache ages", () => {
    const now = Date.UTC(2026, 4, 31, 12, 0, 0);

    expect(formatRelativeAge(null, now)).toBe("never");
    expect(formatRelativeAge(now - 25_000, now)).toBe("just now");
    expect(formatRelativeAge(now - 10 * 60_000, now)).toBe("10m ago");
    expect(formatRelativeAge(now - 3 * 60 * 60_000, now)).toBe("3h ago");
    expect(formatRelativeAge(now - 9 * 24 * 60 * 60_000, now)).toBe("9d ago");
    expect(formatRelativeAge(now - 400 * 24 * 60 * 60_000, now)).toBe("1y ago");
    expect(formatRelativeAge(now + 60_000, now)).toBe("just now");
  });

  it("classifies cache freshness", () => {
    const now = Date.UTC(2026, 4, 31, 12, 0, 0);
    const ttl = 10 * 60_000;

    expect(getCacheFreshness(null, ttl, now)).toMatchObject({ status: "empty", label: "not loaded" });
    expect(getCacheFreshness(now - 2 * 60_000, ttl, now)).toMatchObject({ status: "fresh", label: "2m ago" });
    expect(getCacheFreshness(now - 30 * 60_000, ttl, now)).toMatchObject({ status: "stale", label: "30m ago" });
  });

  it("builds account-aware dashboard and env snippets", () => {
    expect(buildAccountDashboardUrl("abc123")).toBe("https://dash.cloudflare.com/abc123");
    expect(buildAccountDashboardUrl(" account/id ")).toBe("https://dash.cloudflare.com/account%2Fid");
    expect(buildAccountDashboardUrl(null)).toBe("https://dash.cloudflare.com");
    expect(buildWranglerEnvSnippet("abc123")).toContain('CLOUDFLARE_ACCOUNT_ID="abc123"');
    expect(buildWranglerEnvSnippet('abc"$`')).toContain('CLOUDFLARE_ACCOUNT_ID="abc\\"\\$\\`"');
    expect(buildWranglerEnvSnippet(null)).toContain('CLOUDFLARE_ACCOUNT_ID="your-account-id"');
  });

  it("filters commands by title, subtitle, and keywords", () => {
    const commands = [
      { id: "r2", title: "Open R2 Buckets", keywords: ["storage", "assets"] },
      { id: "d1", title: "Open D1 Databases", subtitle: "SQL data" },
      { id: "docs", title: "Cloudflare Docs", keywords: ["workers"] },
    ];

    expect(filterStudioCommands(commands, "r2 storage").map((item) => item.id)).toEqual(["r2"]);
    expect(filterStudioCommands(commands, "sql").map((item) => item.id)).toEqual(["d1"]);
    expect(filterStudioCommands([{ id: "cafe", title: "Café Commands" }], "cafe").map((item) => item.id)).toEqual([
      "cafe",
    ]);
    expect(filterStudioCommands(commands, "").map((item) => item.id)).toEqual(["r2", "d1", "docs"]);
  });

  it("calculates release readiness percentage", () => {
    expect(calculateReleaseReadiness([])).toBe(0);
    expect(calculateReleaseReadiness([
      { id: "tests", passed: true },
      { id: "build", passed: true },
      { id: "tag", passed: false },
    ])).toBe(67);
    expect(calculateReleaseReadiness([
      { id: "tests", passed: false },
      { id: "tests", passed: true },
      { id: "build", passed: true },
    ])).toBe(100);
  });

  it("keeps token permission checklist copyable", () => {
    const text = buildTokenPermissionText();

    expect(text).toContain("Account:Read");
    expect(text).toContain("Workers Scripts:Edit");
    expect(text.split("\n").length).toBeGreaterThan(8);
  });
});
