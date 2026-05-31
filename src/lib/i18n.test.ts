import { describe, expect, it } from "vitest";
import { enUS } from "@/lib/i18n/en-US";
import { zhCN } from "@/lib/i18n/zh-CN";
import { interpolateTranslation, translations } from "@/lib/i18n";

describe("i18n", () => {
  it("keeps locale dictionaries in key parity", () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(enUS).sort());
  });

  it("registers the supported locales", () => {
    expect(Object.keys(translations).sort()).toEqual(["en-US", "zh-CN"]);
  });

  it("interpolates provided variables and preserves unknown placeholders", () => {
    expect(interpolateTranslation("{count} rows in {table}", { count: 3 })).toBe("3 rows in {table}");
  });
});
