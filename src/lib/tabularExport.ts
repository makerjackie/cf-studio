export type TabularExportFormat = "csv" | "json";

function normalizeCell(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function csvEscape(value: unknown): string {
  const text = normalizeCell(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function rowsToCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.map(csvEscape).join(",");
  const body = rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","));
  return [header, ...body].join("\n");
}

export function rowsToJson(rows: Record<string, unknown>[]): string {
  return JSON.stringify(rows, null, 2);
}

export function rowsToFormat(
  rows: Record<string, unknown>[],
  columns: string[],
  format: TabularExportFormat
): string {
  return format === "csv" ? rowsToCsv(rows, columns) : rowsToJson(rows);
}

export function exportFileName(baseName: string, format: TabularExportFormat, date = new Date()): string {
  const safeBase = baseName.trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "d1-export";
  return `${safeBase}-${date.toISOString().slice(0, 10)}.${format}`;
}
