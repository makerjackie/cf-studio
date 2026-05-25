import { describe, expect, it } from "vitest";
import { exportFileName, rowsToCsv, rowsToFormat, rowsToJson } from "@/lib/tabularExport";

const rows = [
  { id: 1, name: "Ada", note: "hello, world" },
  { id: 2, name: "Grace", note: "line\nbreak" },
  { id: 3, name: 'Quote "test"', note: null },
];

describe("tabularExport", () => {
  it("exports CSV with stable column order and escaping", () => {
    expect(rowsToCsv(rows, ["id", "name", "note"])).toBe(
      'id,name,note\n1,Ada,"hello, world"\n2,Grace,"line\nbreak"\n3,"Quote ""test""",'
    );
  });

  it("exports JSON with indentation", () => {
    expect(rowsToJson([{ id: 1, nested: { ok: true } }])).toBe(
      '[\n  {\n    "id": 1,\n    "nested": {\n      "ok": true\n    }\n  }\n]'
    );
  });

  it("switches formats and builds safe file names", () => {
    expect(rowsToFormat(rows, ["id"], "csv")).toBe("id\n1\n2\n3");
    expect(rowsToFormat(rows, ["id"], "json")).toContain('"Ada"');
    expect(exportFileName("users table", "csv", new Date("2026-05-26T00:00:00Z"))).toBe(
      "users-table-2026-05-26.csv"
    );
  });
});
