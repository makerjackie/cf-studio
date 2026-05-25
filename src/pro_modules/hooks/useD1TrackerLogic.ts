import { invoke } from "@tauri-apps/api/core";
import type { D1QueryResult } from "@/hooks/useCloudflare";
import type { TrackedQueryOptions } from "@/hooks/useD1Tracker";

interface TrackerContext {
  sessionId: string;
  activeAccountId?: string | null;
  saveQueryResultsEnabled: boolean;
  saveQueryResultsRowLimit: number | null;
}

function serializableResults(results: D1QueryResult[], rowLimit: number | null) {
  const limit = rowLimit ?? 50;
  return results.map((result) => ({
    success: result.success,
    meta: result.meta,
    error: result.error,
    results: (result.results ?? []).slice(0, limit),
  }));
}

function totalRowsRead(results: D1QueryResult[]) {
  return results.reduce((sum, result) => sum + (result.meta?.rows_read ?? 0), 0);
}

export async function executeTrackedQueryWithLogic(
  options: TrackedQueryOptions,
  executeNetworkCall: () => Promise<D1QueryResult[]>,
  context: TrackerContext,
): Promise<D1QueryResult[]> {
  const results = await executeNetworkCall();

  try {
    await invoke("save_query_history", {
      accountId: options.accountId || context.activeAccountId || "",
      databaseId: options.databaseId,
      sessionId: context.sessionId,
      executionSource: options.source,
      tableName: options.tableName ?? null,
      queryText: options.query,
      rowsRead: totalRowsRead(results),
      resultData: context.saveQueryResultsEnabled
        ? JSON.stringify(serializableResults(results, context.saveQueryResultsRowLimit))
        : null,
    });
  } catch (error) {
    console.warn("Failed to save D1 query history:", error);
  }

  return results;
}
