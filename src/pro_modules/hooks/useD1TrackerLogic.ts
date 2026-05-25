import type { D1QueryResult } from "@/hooks/useCloudflare";

export async function executeTrackedQueryWithLogic(
  _options: unknown,
  executeNetworkCall: () => Promise<D1QueryResult[]>,
  _context?: unknown,
): Promise<D1QueryResult[]> {
  return executeNetworkCall();
}
