export interface QueueMetricsSummary {
  backlogBytes?: number;
  backlogCount?: number;
  oldestMessageTimestampMs?: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function fieldNumber(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  for (const key of keys) {
    const field = record[key];
    if (typeof field === "number" && Number.isFinite(field)) return field;
    if (typeof field === "string" && field.trim()) {
      const parsed = Number(field);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

export function readQueueMetrics(value: unknown): QueueMetricsSummary {
  const record = asRecord(value);
  const metadataMetrics = asRecord(asRecord(record.metadata).metrics);
  const source = Object.keys(metadataMetrics).length > 0 ? metadataMetrics : record;

  return {
    backlogBytes: fieldNumber(source, "backlog_bytes", "backlogBytes"),
    backlogCount: fieldNumber(source, "backlog_count", "backlogCount", "message_backlog_count"),
    oldestMessageTimestampMs: fieldNumber(source, "oldest_message_timestamp_ms", "oldestMessageTimestampMs"),
  };
}
