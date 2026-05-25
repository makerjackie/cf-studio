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

function getNumber(value: unknown, key: string): number {
  const field = asRecord(value)[key];
  if (typeof field === "number" && Number.isFinite(field)) return field;
  if (typeof field === "string" && field.trim()) {
    const parsed = Number(field);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
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
    const status = typeof dimensions.status === "string" ? dimensions.status : "unknown";
    const requests = getNumber(sum, "requests");
    const errors = getNumber(sum, "errors");

    summary.requests += requests;
    summary.errors += errors;
    summary.subrequests += getNumber(sum, "subrequests");
    summary.cpuP50 = Math.max(summary.cpuP50, getNumber(quantiles, "cpuTimeP50"));
    summary.cpuP99 = Math.max(summary.cpuP99, getNumber(quantiles, "cpuTimeP99"));
    summary.statuses.set(status, (summary.statuses.get(status) ?? 0) + requests);
  }

  summary.successes = Math.max(0, summary.requests - summary.errors);
  return summary;
}
