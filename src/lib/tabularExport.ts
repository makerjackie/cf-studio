export type TabularExportFormat = "csv" | "json";

const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;
const MAX_FILE_BASENAME_LENGTH = 80;

function safeJsonStringify(value: object): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable object]";
  }
}

function normalizeCell(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object") return safeJsonStringify(value);
  return String(value);
}

function csvEscape(value: unknown): string {
  const normalized = normalizeCell(value);
  const text = typeof value === "string" && CSV_FORMULA_PREFIX.test(normalized)
    ? `'${normalized}`
    : normalized;
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
  const safeBase = baseName
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^\.+$/, "")
    .replace(/^\.+/, "")
    .slice(0, MAX_FILE_BASENAME_LENGTH) || "d1-export";
  return `${safeBase}-${date.toISOString().slice(0, 10)}.${format}`;
}
