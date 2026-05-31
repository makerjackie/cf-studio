import { describe, expect, it } from "vitest";
import { readQueueMetrics } from "./queueMetrics";

describe("readQueueMetrics", () => {
  it("reads Queue metrics endpoint fields", () => {
    expect(
      readQueueMetrics({
        backlog_bytes: 2048,
        backlog_count: 12,
        oldest_message_timestamp_ms: 1770000000000,
      })
    ).toEqual({
      backlogBytes: 2048,
      backlogCount: 12,
      oldestMessageTimestampMs: 1770000000000,
    });
  });

  it("reads send message metadata metrics", () => {
    expect(
      readQueueMetrics({
        metadata: {
          metrics: {
            backlog_bytes: "1024",
            backlog_count: "3",
            oldest_message_timestamp_ms: "1770000000000",
          },
        },
      })
    ).toEqual({
      backlogBytes: 1024,
      backlogCount: 3,
      oldestMessageTimestampMs: 1770000000000,
    });
  });

  it("falls back to pull response backlog count", () => {
    expect(readQueueMetrics({ message_backlog_count: 5 })).toEqual({
      backlogBytes: undefined,
      backlogCount: 5,
      oldestMessageTimestampMs: undefined,
    });
  });

  it("reads nested metrics from result and normalizes aliases", () => {
    expect(
      readQueueMetrics({
        result: {
          metrics: {
            backlogBytes: "1,024",
            messagesBacklogCount: "7",
            oldestMessageTimestamp: "2026-05-31T00:00:00.000Z",
          },
        },
      })
    ).toEqual({
      backlogBytes: 1024,
      backlogCount: 7,
      oldestMessageTimestampMs: Date.parse("2026-05-31T00:00:00.000Z"),
    });
  });

  it("clamps negative metric values and converts second timestamps", () => {
    expect(
      readQueueMetrics({
        metrics: {
          backlog_bytes: -200,
          messageBacklogCount: "-4",
          oldest_message_timestamp: 1_770_000_000,
        },
      })
    ).toEqual({
      backlogBytes: 0,
      backlogCount: 0,
      oldestMessageTimestampMs: 1_770_000_000_000,
    });
  });
});
