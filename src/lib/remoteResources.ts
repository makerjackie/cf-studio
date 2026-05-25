import { invokeCloudflare } from "@/hooks/useCloudflare";

export interface KVNamespace {
  id: string;
  title: string;
  supports_url_encoding?: boolean;
}

export interface KVKey {
  name: string;
  expiration?: number;
  metadata?: unknown;
}

export interface KVKeyListResult {
  keys: KVKey[];
  cursor?: string;
}

export interface KVEntry {
  key: string;
  value: string;
  metadata?: unknown;
  expiration?: string;
}

export interface RemoteSection<T = unknown> {
  data?: T | null;
  error?: string | null;
}

export interface WorkerSummary {
  name: string;
  created_on?: string;
  modified_on?: string;
  last_deployed_from?: string;
  workers_dev_url?: string;
  routes: unknown[];
  domains: unknown[];
  bindings: unknown[];
  observability?: unknown;
  raw: Record<string, unknown>;
}

export interface WorkersOverview {
  account_id: string;
  account_subdomain?: string;
  subdomain_error?: string;
  domains_error?: string;
  workers: WorkerSummary[];
}

export interface WorkerDetail {
  account_id: string;
  account_subdomain?: string;
  script: Record<string, unknown>;
  domains: unknown[];
  subdomain: RemoteSection<Record<string, unknown>>;
  settings: RemoteSection<Record<string, unknown>>;
  script_settings: RemoteSection<Record<string, unknown>>;
  deployments: RemoteSection<Record<string, unknown>>;
  versions: RemoteSection<Record<string, unknown>>;
  secrets: RemoteSection<unknown[]>;
  schedules: RemoteSection<Record<string, unknown>>;
  tails: RemoteSection<Record<string, unknown>>;
}

export interface WorkerMetrics {
  start: string;
  end: string;
  rows: Record<string, unknown>[];
  raw: Record<string, unknown>;
}

export interface QueuesOverview {
  account_id: string;
  queues: Record<string, unknown>[];
}

export interface QueueDetail {
  queue: RemoteSection<Record<string, unknown>>;
  metrics: RemoteSection<Record<string, unknown>>;
}

export function fetchKVNamespaces(): Promise<KVNamespace[]> {
  return invokeCloudflare<KVNamespace[]>("fetch_kv_namespaces");
}

export function listKVKeys(
  namespaceId: string,
  prefix: string,
  cursor?: string,
  limit = 100
): Promise<KVKeyListResult> {
  return invokeCloudflare<KVKeyListResult>("list_kv_keys", {
    namespaceId,
    prefix,
    cursor,
    limit,
  });
}

export function getKVEntry(namespaceId: string, keyName: string): Promise<KVEntry> {
  return invokeCloudflare<KVEntry>("get_kv_entry", { namespaceId, keyName });
}

export function putKVEntry(
  namespaceId: string,
  keyName: string,
  value: string,
  expirationTtl?: number,
  expiration?: string,
  metadata?: unknown
): Promise<void> {
  return invokeCloudflare<void>("put_kv_entry", {
    namespaceId,
    keyName,
    value,
    expirationTtl,
    expiration,
    metadata,
  });
}

export function deleteKVEntry(namespaceId: string, keyName: string): Promise<void> {
  return invokeCloudflare<void>("delete_kv_entry", { namespaceId, keyName });
}

export function fetchWorkersOverview(): Promise<WorkersOverview> {
  return invokeCloudflare<WorkersOverview>("fetch_workers_overview");
}

export function fetchWorkerDetail(scriptName: string): Promise<WorkerDetail> {
  return invokeCloudflare<WorkerDetail>("fetch_worker_detail", { scriptName });
}

export function upsertWorkerSecret(
  scriptName: string,
  secretName: string,
  secretValue: string
): Promise<void> {
  return invokeCloudflare<void>("upsert_worker_secret", {
    scriptName,
    secretName,
    secretValue,
  });
}

export function setWorkerSubdomain(
  scriptName: string,
  enabled: boolean,
  previewsEnabled: boolean
): Promise<unknown> {
  return invokeCloudflare<unknown>("set_worker_subdomain", {
    scriptName,
    enabled,
    previewsEnabled,
  });
}

export function updateWorkerSchedules(scriptName: string, crons: string[]): Promise<unknown> {
  return invokeCloudflare<unknown>("update_worker_schedules", { scriptName, crons });
}

export function startWorkerTail(scriptName: string): Promise<unknown> {
  return invokeCloudflare<unknown>("start_worker_tail", { scriptName });
}

export function updateWorkerObservability(
  scriptName: string,
  enabled: boolean,
  headSamplingRate: number,
  invocationLogs: boolean
): Promise<unknown> {
  return invokeCloudflare<unknown>("update_worker_observability", {
    scriptName,
    enabled,
    headSamplingRate,
    invocationLogs,
  });
}

export function fetchWorkerMetrics(scriptName: string, minutes: number): Promise<WorkerMetrics> {
  return invokeCloudflare<WorkerMetrics>("fetch_worker_metrics", { scriptName, minutes });
}

export function attachWorkerDomain(
  scriptName: string,
  hostname: string,
  zoneId?: string,
  zoneName?: string,
  environment?: string
): Promise<unknown> {
  return invokeCloudflare<unknown>("attach_worker_domain", {
    scriptName,
    hostname,
    zoneId,
    zoneName,
    environment,
  });
}

export function detachWorkerDomain(domainId: string): Promise<unknown> {
  return invokeCloudflare<unknown>("detach_worker_domain", { domainId });
}

export function attachWorkerRoute(scriptName: string, zoneId: string, pattern: string): Promise<unknown> {
  return invokeCloudflare<unknown>("attach_worker_route", { scriptName, zoneId, pattern });
}

export function detachWorkerRoute(zoneId: string, routeId: string): Promise<unknown> {
  return invokeCloudflare<unknown>("detach_worker_route", { zoneId, routeId });
}

export function deleteWorkerSecret(scriptName: string, secretName: string): Promise<void> {
  return invokeCloudflare<void>("delete_worker_secret", { scriptName, secretName });
}

export function fetchQueuesOverview(): Promise<QueuesOverview> {
  return invokeCloudflare<QueuesOverview>("fetch_queues_overview");
}

export function fetchQueueDetail(queueId: string): Promise<QueueDetail> {
  return invokeCloudflare<QueueDetail>("fetch_queue_detail", { queueId });
}

export function sendQueueMessage(
  queueId: string,
  body: string,
  contentType: "text" | "json",
  delaySeconds?: number
): Promise<unknown> {
  return invokeCloudflare<unknown>("send_queue_message", {
    queueId,
    body,
    contentType,
    delaySeconds,
  });
}

export function sendQueueBatch(
  queueId: string,
  messages: string[],
  contentType: "text" | "json",
  delaySeconds?: number
): Promise<unknown> {
  return invokeCloudflare<unknown>("send_queue_batch", {
    queueId,
    messages,
    contentType,
    delaySeconds,
  });
}
