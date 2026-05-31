export interface WorkerMetricSummary {
  requests: number;
  successes: number;
  errors: number;
  subrequests: number;
  cpuP50: number;
  cpuP99: number;
  statuses: Map<string, number>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }
  return 0;
}

function getNumber(value: unknown, ...keys: string[]): number {
  const record = asRecord(value);
  for (const key of keys) {
    if (key in record) return parseNumber(record[key]);
  }
  return 0;
}

function getStatus(dimensions: Record<string, unknown>) {
  const status = dimensions.status ?? dimensions.statusCode ?? dimensions.outcome ?? dimensions.eventType;
  if (typeof status === "string" && status.trim()) return status.trim();
  if (typeof status === "number" && Number.isFinite(status)) return String(status);
  return "unknown";
}

export function summarizeWorkerMetricRows(rows: unknown[] | null | undefined): WorkerMetricSummary {
  const summary: WorkerMetricSummary = {
    requests: 0,
    successes: 0,
    errors: 0,
    subrequests: 0,
    cpuP50: 0,
    cpuP99: 0,
    statuses: new Map<string, number>(),
  };

  for (const row of rows ?? []) {
    const record = asRecord(row);
    const sum = asRecord(record.sum);
    const quantiles = asRecord(record.quantiles);
    const dimensions = asRecord(record.dimensions);
    const status = getStatus(dimensions);
    const requests = getNumber(sum, "requests", "requestCount", "requestsTotal");
    const errors = getNumber(sum, "errors", "errorCount", "errorsTotal");

    summary.requests += requests;
    summary.errors += errors;
    summary.subrequests += getNumber(sum, "subrequests", "subrequestCount");
    summary.cpuP50 = Math.max(summary.cpuP50, getNumber(quantiles, "cpuTimeP50", "cpu_time_p50", "cpuTime50"));
    summary.cpuP99 = Math.max(summary.cpuP99, getNumber(quantiles, "cpuTimeP99", "cpu_time_p99", "cpuTime99"));
    if (requests > 0) {
      summary.statuses.set(status, (summary.statuses.get(status) ?? 0) + requests);
    }
  }

  summary.successes = Math.max(0, summary.requests - summary.errors);
  return summary;
}
