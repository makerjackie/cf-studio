import { useCallback, useEffect } from "react";
import { type D1QueryResult } from "@/hooks/useCloudflare";
import { useAppStore } from "@/store/useAppStore";

export type ExecutionSource = "UI_ACTION" | "RAW_QUERY";

export interface TrackedQueryOptions {
  query: string;
  databaseId: string;
  accountId: string;
  tableName?: string | null;
  source: ExecutionSource;
}

let proLogic: any = null;

/**
 * Public query tracking wrapper. History is local-only and records metadata
 * after successful D1 calls without changing the Cloudflare request path.
 */
export function useD1Tracker() {
  const sessionId = useAppStore((state) => state.sessionId);
  const activeAccountId = useAppStore((state) => state.activeAccount?.id);
  const saveQueryResultsEnabled = useAppStore((state) => state.saveQueryResultsEnabled);
  const saveQueryResultsRowLimit = useAppStore((state) => state.saveQueryResultsRowLimit);

  useEffect(() => {
    import("@/pro_modules/hooks/useD1TrackerLogic")
      .then((m) => {
        proLogic = m.executeTrackedQueryWithLogic;
      })
      .catch(() => {});
  }, []);

  const executeTrackedQuery = useCallback(
    async (
      options: TrackedQueryOptions,
      executeNetworkCall: () => Promise<D1QueryResult[]>
    ): Promise<D1QueryResult[]> => {
      try {
        if (proLogic) {
          return await proLogic(
            options,
            executeNetworkCall,
            {
              sessionId,
              activeAccountId,
              saveQueryResultsEnabled,
              saveQueryResultsRowLimit,
            }
          );
        } else {
           const m = await import("@/pro_modules/hooks/useD1TrackerLogic").catch(() => null);
           if (m?.executeTrackedQueryWithLogic) {
             return await m.executeTrackedQueryWithLogic(
                options,
                executeNetworkCall,
                {
                  sessionId,
                  activeAccountId,
                  saveQueryResultsEnabled,
                  saveQueryResultsRowLimit,
                }
             );
           }
        }
      } catch (e) {
        console.error("Pro tracker logic execution failed:", e);
      }

      // Fallback
      return await executeNetworkCall();
    },
    [sessionId, activeAccountId, saveQueryResultsEnabled, saveQueryResultsRowLimit]
  );

  return { executeTrackedQuery };
}
