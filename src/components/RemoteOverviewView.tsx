import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Box,
  Database,
  KeyRound,
  Loader2,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/store/useAppStore";
import { useD1Databases } from "@/hooks/useCloudflare";
import { useR2Buckets } from "@/hooks/useCloudflare";
import {
  fetchKVNamespaces,
  fetchQueuesOverview,
  fetchWorkersOverview,
  type KVNamespace,
  type QueuesOverview,
  type WorkersOverview,
} from "@/lib/remoteResources";
import { cn } from "@/lib/utils";

type LoadState = "idle" | "loading" | "error";

interface OverviewProps {
  onNavigate: (id: string) => void;
}

function formatDate(value?: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function CountTile({
  icon: Icon,
  label,
  count,
  status,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  count: number | string;
  status?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-lg border border-border bg-background p-4 text-left transition-colors",
        "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <Icon size={17} className="text-primary" />
        {status && <Badge variant="secondary">{status}</Badge>}
      </div>
      <p className="mt-4 text-2xl font-semibold tracking-tight">{count}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </button>
  );
}

function RiskItem({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle size={16} className="mt-0.5 text-amber-600" />
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
        </div>
      </div>
    </div>
  );
}

export function RemoteOverviewView({ onNavigate }: OverviewProps) {
  const activeAccount = useAppStore((state) => state.activeAccount);
  const userProfile = useAppStore((state) => state.userProfile);
  const d1 = useD1Databases();
  const r2 = useR2Buckets();
  const [workers, setWorkers] = useState<WorkersOverview | null>(null);
  const [kv, setKV] = useState<KVNamespace[]>([]);
  const [queues, setQueues] = useState<QueuesOverview | null>(null);
  const [remoteStatus, setRemoteStatus] = useState<LoadState>("idle");
  const [remoteError, setRemoteError] = useState<string | null>(null);

  const loadRemoteResources = useCallback(async () => {
    setRemoteStatus("loading");
    setRemoteError(null);
    try {
      const [workersData, kvData, queuesData] = await Promise.all([
        fetchWorkersOverview(),
        fetchKVNamespaces(),
        fetchQueuesOverview(),
      ]);
      setWorkers(workersData);
      setKV(kvData);
      setQueues(queuesData);
      setRemoteStatus("idle");
    } catch (error) {
      setRemoteError(String(error));
      setRemoteStatus("error");
    }
  }, []);

  useEffect(() => {
    loadRemoteResources();
  }, [loadRemoteResources]);

  const recentlyModifiedWorkers = useMemo(() => {
    return [...(workers?.workers ?? [])]
      .sort((a, b) => {
        const aTime = new Date(a.modified_on ?? a.created_on ?? 0).getTime();
        const bTime = new Date(b.modified_on ?? b.created_on ?? 0).getTime();
        return bTime - aTime;
      })
      .slice(0, 4);
  }, [workers]);

  const workerDomainCount = workers?.workers.reduce((sum, worker) => sum + worker.domains.length + worker.routes.length, 0) ?? 0;
  const boundWorkers = workers?.workers.filter((worker) => worker.bindings.length > 0).length ?? 0;
  const workerRecentErrors = workers?.workers.reduce((sum, worker) => sum + (worker.recent_metrics?.errors ?? 0), 0) ?? 0;
  const workersWithRecentErrors = workers?.workers.filter((worker) => (worker.recent_metrics?.errors ?? 0) > 0).length ?? 0;

  return (
    <div className="flex h-full flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Remote Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cloudflare resources for the selected account.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="secondary">{activeAccount?.name ?? "No account selected"}</Badge>
            {userProfile?.email && <Badge variant="outline">{userProfile.email}</Badge>}
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            d1.refresh();
            r2.refresh();
            loadRemoteResources();
          }}
          disabled={remoteStatus === "loading"}
        >
          {remoteStatus === "loading" ? (
            <Loader2 size={15} className="mr-2 animate-spin" />
          ) : (
            <RefreshCw size={15} className="mr-2" />
          )}
          Refresh
        </Button>
      </div>

      {remoteStatus === "error" && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {remoteError}
        </div>
      )}

      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <CountTile
          icon={Box}
          label="R2 buckets"
          count={r2.state.status === "success" ? r2.state.data.length : "—"}
          status={r2.isFromCache ? "cached" : undefined}
          onClick={() => onNavigate("r2")}
        />
        <CountTile
          icon={Database}
          label="D1 databases"
          count={d1.state.status === "success" ? d1.state.data.length : "—"}
          status={d1.isFromCache ? "cached" : undefined}
          onClick={() => onNavigate("d1")}
        />
        <CountTile icon={KeyRound} label="KV namespaces" count={kv.length} onClick={() => onNavigate("kv")} />
        <CountTile
          icon={Workflow}
          label="Workers"
          count={workers?.workers.length ?? "—"}
          status={workerRecentErrors > 0 ? `${workerRecentErrors} errors` : undefined}
          onClick={() => onNavigate("workers")}
        />
        <CountTile icon={MessageSquare} label="Queues" count={queues?.queues.length ?? "—"} onClick={() => onNavigate("queues")} />
        <CountTile icon={ShieldCheck} label="Token check" count="Open" onClick={() => onNavigate("permissions")} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-lg border border-border bg-background">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Recently updated Workers</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Remote scripts sorted by modification time.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onNavigate("workers")}>
              Open Workers
            </Button>
          </div>
          <div className="divide-y divide-border">
            {recentlyModifiedWorkers.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No Workers loaded yet.</p>
            ) : (
              recentlyModifiedWorkers.map((worker) => (
                <button
                  key={worker.name}
                  className="grid w-full grid-cols-[1fr_auto] items-center gap-4 px-4 py-3 text-left hover:bg-muted/40"
                  onClick={() => onNavigate("workers")}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{worker.name}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      Updated {formatDate(worker.modified_on ?? worker.created_on)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {worker.domains.length > 0 && <Badge variant="secondary">domain</Badge>}
                    {worker.routes.length > 0 && <Badge variant="secondary">route</Badge>}
                    {worker.bindings.length > 0 && <Badge variant="outline">bindings</Badge>}
                    {(worker.recent_metrics?.errors ?? 0) > 0 && (
                      <Badge variant="destructive">{worker.recent_metrics?.errors} errors</Badge>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="grid gap-3">
          <RiskItem
            title="Remote write operations need confirmation"
            body="Deletes, overwrites, Worker secret changes, route changes, and domain changes should require a second confirmation before calling Cloudflare."
          />
          <RiskItem
            title={`${workerDomainCount} Worker traffic entry points`}
            body="Custom domains and routes affect production traffic. Review them from the Worker detail page before editing."
          />
          <RiskItem
            title={`${boundWorkers} Workers with visible bindings`}
            body="Bindings connect Workers to D1, R2, KV, Queues, and other resources. Use the detail page to inspect missing permissions or unresolved resources."
          />
          <RiskItem
            title={`${workerRecentErrors} recent Worker errors`}
            body={
              workers?.metrics_error
                ? "Worker health metrics need Account Analytics read access. Resource lists still load without treating the Worker as unhealthy."
                : `${workersWithRecentErrors} Workers reported errors in the last hour. Open Workers to filter and inspect them.`
            }
          />
        </div>
      </section>
    </div>
  );
}
