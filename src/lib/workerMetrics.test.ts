import { describe, expect, it } from "vitest";
import { summarizeWorkerMetricRows } from "./workerMetrics";

describe("summarizeWorkerMetricRows", () => {
  it("aggregates request, success, error, subrequest, cpu, and status counts", () => {
    const summary = summarizeWorkerMetricRows([
      {
        sum: { requests: 10, errors: 2, subrequests: 30 },
        quantiles: { cpuTimeP50: 1200, cpuTimeP99: 9000 },
        dimensions: { status: "ok" },
      },
      {
        sum: { requests: "5", errors: "1", subrequests: "8" },
        quantiles: { cpuTimeP50: 1800, cpuTimeP99: 5000 },
        dimensions: { status: "exception" },
      },
    ]);

    expect(summary.requests).toBe(15);
    expect(summary.successes).toBe(12);
    expect(summary.errors).toBe(3);
    expect(summary.subrequests).toBe(38);
    expect(summary.cpuP50).toBe(1800);
    expect(summary.cpuP99).toBe(9000);
    expect(Array.from(summary.statuses.entries())).toEqual([
      ["ok", 10],
      ["exception", 5],
    ]);
  });

  it("never reports negative successes", () => {
    const summary = summarizeWorkerMetricRows([
      {
        sum: { requests: 1, errors: 3 },
        dimensions: { status: "exception" },
      },
    ]);

    expect(summary.successes).toBe(0);
  });
});
