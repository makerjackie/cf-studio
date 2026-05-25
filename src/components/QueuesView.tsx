import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Clipboard,
  Loader2,
  MessageSquare,
  Play,
  RefreshCw,
  Search,
  Send,
  Users,
} from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchQueueDetail,
  fetchQueuesOverview,
  sendQueueBatch,
  sendQueueMessage,
  type QueueDetail,
  type QueuesOverview,
} from "@/lib/remoteResources";
import { readQueueMetrics } from "@/lib/queueMetrics";
import { cn } from "@/lib/utils";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function fieldString(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  for (const key of keys) {
    const field = record[key];
    if (typeof field === "string" && field) return field;
  }
  return undefined;
}

function queueId(queue: unknown) {
  return fieldString(queue, "queue_id", "id", "name") ?? "";
}

function queueName(queue: unknown) {
  return fieldString(queue, "queue_name", "name", "id") ?? "queue";
}

function formatCompact(value?: number) {
  if (value === undefined) return "—";
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatBytes(value?: number) {
  if (value === undefined) return "—";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatTimestampMs(value?: number) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function SectionError({ error }: { error?: string | null }) {
  if (!error) return null;
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700">
      {error}
    </div>
  );
}

export function QueuesView() {
  const [overview, setOverview] = useState<QueuesOverview | null>(null);
  const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);
  const [detail, setDetail] = useState<QueueDetail | null>(null);
  const [query, setQuery] = useState("");
  const [body, setBody] = useState("{\n  \"hello\": \"world\"\n}");
  const [contentType, setContentType] = useState<"json" | "text">("json");
  const [batchMode, setBatchMode] = useState(false);
  const [delaySeconds, setDelaySeconds] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sending">("idle");
  const [detailStatus, setDetailStatus] = useState<"idle" | "loading">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);

  const loadQueues = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const data = await fetchQueuesOverview();
      setOverview(data);
      setSelectedQueueId((current) => current ?? (queueId(data.queues[0]) || null));
      setStatus("idle");
    } catch (loadError) {
      setError(String(loadError));
      setStatus("idle");
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetailStatus("loading");
    setError(null);
    try {
      const data = await fetchQueueDetail(id);
      setDetail(data);
      setDetailStatus("idle");
    } catch (loadError) {
      setError(String(loadError));
      setDetailStatus("idle");
    }
  }, []);

  useEffect(() => {
    loadQueues();
  }, [loadQueues]);

  useEffect(() => {
    if (selectedQueueId) {
      loadDetail(selectedQueueId);
    }
  }, [loadDetail, selectedQueueId]);

  const filteredQueues = useMemo(() => {
    const lowerQuery = query.trim().toLowerCase();
    return (overview?.queues ?? []).filter((queue) => queueName(queue).toLowerCase().includes(lowerQuery));
  }, [overview, query]);

  const selectedQueue = useMemo(() => {
    return (overview?.queues ?? []).find((queue) => queueId(queue) === selectedQueueId) ?? null;
  }, [overview, selectedQueueId]);

  const consumers = asArray(asRecord(detail?.queue.data).consumers);
  const producers = asArray(asRecord(detail?.queue.data).producers);
  const metrics = readQueueMetrics(detail?.metrics.data);
  const resultMetrics = readQueueMetrics(result);

  const sendMessage = async () => {
    if (!selectedQueueId) return;
    const delay = delaySeconds.trim() ? Number(delaySeconds) : undefined;
    if (delay !== undefined && (!Number.isFinite(delay) || delay < 0)) {
      setError("Delay must be empty or a positive number.");
      return;
    }
    if (contentType === "json") {
      try {
        if (batchMode) {
          body.split("\n").filter((line) => line.trim()).forEach((line) => JSON.parse(line));
        } else {
          JSON.parse(body);
        }
      } catch (jsonError) {
        setError(`Invalid JSON: ${String(jsonError)}`);
        return;
      }
    }
    setStatus("sending");
    setError(null);
    setResult(null);
    try {
      const sendResult = batchMode
        ? await sendQueueBatch(
            selectedQueueId,
            body.split("\n").filter((line) => line.trim()),
            contentType,
            delay
          )
        : await sendQueueMessage(selectedQueueId, body, contentType, delay);
      setResult(sendResult);
      setStatus("idle");
    } catch (sendError) {
      setError(String(sendError));
      setStatus("idle");
    }
  };

  return (
    <div className="flex h-full flex-col gap-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Queues</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Inspect remote Queues and send test messages to validate Worker producers and consumers.
          </p>
        </div>
        <Button variant="outline" onClick={loadQueues} disabled={status === "loading"}>
          {status === "loading" ? <Loader2 size={15} className="mr-2 animate-spin" /> : <RefreshCw size={15} className="mr-2" />}
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[340px_1fr]">
        <section className="min-h-0 overflow-hidden rounded-lg border border-border bg-muted/10">
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Queues" className="h-9 pl-8" />
            </div>
          </div>
          <div className="grid gap-2 overflow-y-auto p-3">
            {filteredQueues.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No Queues found.</p>
            ) : (
              filteredQueues.map((queue) => {
                const id = queueId(queue);
                return (
                  <button
                    key={id}
                    onClick={() => setSelectedQueueId(id)}
                    className={cn(
                      "rounded-lg border border-border bg-background p-4 text-left hover:bg-muted/40",
                      selectedQueueId === id && "border-primary/50 bg-primary/5"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{queueName(queue)}</p>
                        <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{id}</p>
                      </div>
                      <MessageSquare size={16} className="text-primary" />
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="min-h-0 overflow-y-auto">
          {!selectedQueue ? (
            <div className="flex h-full items-center justify-center rounded-lg border border-border bg-muted/20 p-8 text-sm text-muted-foreground">
              Select a Queue to inspect details and send test messages.
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="rounded-lg border border-border bg-background p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold tracking-tight">{queueName(selectedQueue)}</h2>
                    <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{selectedQueueId}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => writeText(selectedQueueId ?? "", { label: "CF Studio" })}>
                      <Clipboard size={14} className="mr-2" />
                      Copy ID
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => selectedQueueId && loadDetail(selectedQueueId)} disabled={detailStatus === "loading"}>
                      {detailStatus === "loading" ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-border bg-background p-4">
                  <p className="text-2xl font-semibold">{formatCompact(metrics.backlogCount)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Backlog messages</p>
                </div>
                <div className="rounded-lg border border-border bg-background p-4">
                  <p className="text-2xl font-semibold">{formatBytes(metrics.backlogBytes)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Backlog size</p>
                </div>
                <div className="rounded-lg border border-border bg-background p-4">
                  <p className="truncate text-lg font-semibold">{formatTimestampMs(metrics.oldestMessageTimestampMs)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Oldest message</p>
                </div>
                <div className="rounded-lg border border-border bg-background p-4">
                  <p className="text-2xl font-semibold">
                    {consumers.length}/{producers.length}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">Consumers / producers</p>
                </div>
              </div>

              <SectionError error={detail?.queue.error} />
              <SectionError error={detail?.metrics.error} />

              <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
                <div className="rounded-lg border border-border bg-background p-4">
                  <div className="flex items-center gap-2">
                    <Play size={16} className="text-primary" />
                    <h3 className="text-sm font-semibold">Send test message</h3>
                  </div>
                  <div className="mt-4 grid gap-3">
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant={contentType === "json" ? "default" : "outline"} onClick={() => setContentType("json")}>
                        JSON
                      </Button>
                      <Button size="sm" variant={contentType === "text" ? "default" : "outline"} onClick={() => setContentType("text")}>
                        Text
                      </Button>
                      <Button size="sm" variant={batchMode ? "default" : "outline"} onClick={() => setBatchMode((value) => !value)}>
                        Batch
                      </Button>
                    </div>
                    <Textarea
                      value={body}
                      onChange={(event) => setBody(event.target.value)}
                      className="min-h-[220px] resize-none font-mono text-xs"
                      placeholder={batchMode ? "One message per line" : "Message body"}
                    />
                    <div className="flex flex-wrap items-end gap-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">Delay seconds</label>
                        <Input
                          value={delaySeconds}
                          onChange={(event) => setDelaySeconds(event.target.value.replace(/[^\d]/g, ""))}
                          placeholder="Optional"
                          className="w-36"
                        />
                      </div>
                      <Button onClick={sendMessage} disabled={status === "sending" || !selectedQueueId}>
                        {status === "sending" ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Send size={14} className="mr-2" />}
                        Send
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4">
                  <div className="rounded-lg border border-border bg-background p-4">
                    <div className="flex items-center gap-2">
                      <Users size={16} className="text-primary" />
                      <h3 className="text-sm font-semibold">Relations</h3>
                    </div>
                    <pre className="mt-3 max-h-60 overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
                      {JSON.stringify({ consumers, producers }, null, 2)}
                    </pre>
                  </div>
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={15} className="mt-0.5 text-amber-600" />
                      <p className="text-sm leading-6 text-muted-foreground">
                        Sending a test message writes to the remote Queue. It may trigger production consumers.
                      </p>
                    </div>
                  </div>
                  {result !== null && (
                    <div className="rounded-lg border border-border bg-background p-4">
                      <h3 className="text-sm font-semibold">Send result</h3>
                      <div className="mt-3 grid gap-2 md:grid-cols-3">
                        <div className="rounded-md bg-muted/30 px-3 py-2">
                          <p className="text-xs text-muted-foreground">Backlog</p>
                          <p className="mt-1 font-mono text-sm">{formatCompact(resultMetrics.backlogCount)}</p>
                        </div>
                        <div className="rounded-md bg-muted/30 px-3 py-2">
                          <p className="text-xs text-muted-foreground">Backlog size</p>
                          <p className="mt-1 font-mono text-sm">{formatBytes(resultMetrics.backlogBytes)}</p>
                        </div>
                        <div className="rounded-md bg-muted/30 px-3 py-2">
                          <p className="text-xs text-muted-foreground">Oldest message</p>
                          <p className="mt-1 truncate font-mono text-sm">{formatTimestampMs(resultMetrics.oldestMessageTimestampMs)}</p>
                        </div>
                      </div>
                      <pre className="mt-3 max-h-60 overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
                        {JSON.stringify(result, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
