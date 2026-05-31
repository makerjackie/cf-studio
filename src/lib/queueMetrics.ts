export interface QueueMetricsSummary {
  backlogBytes?: number;
  backlogCount?: number;
  oldestMessageTimestampMs?: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }
  return undefined;
}

function fieldNumber(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  for (const key of keys) {
    const parsed = parseNumber(record[key]);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function fieldTimestampMs(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  for (const key of keys) {
    const numeric = parseNumber(record[key]);
    if (numeric !== undefined) {
      return numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
    }

    const field = record[key];
    if (typeof field === "string" && field.trim()) {
      const parsed = Date.parse(field);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function firstNonEmptyRecord(...values: unknown[]) {
  return values.map(asRecord).find((record) => Object.keys(record).length > 0) ?? {};
}

export function readQueueMetrics(value: unknown): QueueMetricsSummary {
  const record = asRecord(value);
  const metadataMetrics = asRecord(asRecord(record.metadata).metrics);
  const source = firstNonEmptyRecord(metadataMetrics, record.metrics, asRecord(record.result).metrics, record);

  return {
    backlogBytes: fieldNumber(source, "backlog_bytes", "backlogBytes"),
    backlogCount: fieldNumber(
      source,
      "backlog_count",
      "backlogCount",
      "message_backlog_count",
      "messageBacklogCount",
      "messagesBacklogCount"
    ),
    oldestMessageTimestampMs: fieldTimestampMs(
      source,
      "oldest_message_timestamp_ms",
      "oldestMessageTimestampMs",
      "oldest_message_timestamp",
      "oldestMessageTimestamp"
    ),
  };
}
