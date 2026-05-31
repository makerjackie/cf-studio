import { useCallback, useEffect, useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-shell";
import {
  Clock,
  Clipboard,
  ExternalLink,
  Globe,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  Terminal,
  Trash2,
  Workflow,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  attachWorkerDomain,
  attachWorkerRoute,
  deleteWorkerSecret,
  detachWorkerDomain,
  detachWorkerRoute,
  fetchWorkerMetrics,
  fetchWorkerDetail,
  fetchWorkersOverview,
  setWorkerSubdomain,
  startWorkerTail,
  updateWorkerObservability,
  updateWorkerSchedules,
  upsertWorkerSecret,
  type RemoteSection,
  type WorkerDetail,
  type WorkerMetrics,
  type WorkerSummary,
  type WorkersOverview,
} from "@/lib/remoteResources";
import { summarizeWorkerMetricRows } from "@/lib/workerMetrics";
import { cn } from "@/lib/utils";
import { useI18n, type TranslationKey } from "@/lib/i18n";

const WORKERS_DOCS_URL = "https://developers.cloudflare.com/workers/";
const WORKERS_LOGS_DOCS_URL = "https://developers.cloudflare.com/workers/observability/logs/workers-logs/";
const WORKERS_METRICS_DOCS_URL = "https://developers.cloudflare.com/workers/observability/metrics-and-analytics/";

type FilterMode = "all" | "errors" | "domains" | "routes" | "bindings" | "observability";

const FILTER_LABEL_KEYS = {
  all: "workers.filter.all",
  errors: "workers.filter.errors",
  domains: "workers.filter.domains",
  routes: "workers.filter.routes",
  bindings: "workers.filter.bindings",
  observability: "workers.filter.observability",
} satisfies Record<FilterMode, TranslationKey>;

const METRIC_RANGES = [
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "24h", minutes: 60 * 24 },
  { label: "7d", minutes: 60 * 24 * 7 },
];

interface WorkersViewProps {
  onNavigate: (id: string) => void;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getString(value: unknown, key: string): string | undefined {
  const field = asRecord(value)[key];
  return typeof field === "string" ? field : undefined;
}

function getBool(value: unknown, key: string): boolean | undefined {
  const field = asRecord(value)[key];
  return typeof field === "boolean" ? field : undefined;
}

function getOptionalNumber(value: unknown, key: string): number | undefined {
  const field = asRecord(value)[key];
  if (typeof field === "number" && Number.isFinite(field)) return field;
  if (typeof field === "string" && field.trim()) {
    const parsed = Number(field);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function dateLabel(value: string | null | undefined, unknownLabel: string) {
  if (!value) return unknownLabel;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function dashboardUrl(accountId: string, workerName: string) {
  return `https://dash.cloudflare.com/${accountId}/workers/services/view/${encodeURIComponent(workerName)}`;
}

function workerBindings(detail: WorkerDetail | null): unknown[] {
  if (!detail) return [];
  const settingsBindings = asArray(asRecord(detail.settings.data).bindings);
  const scriptBindings = asArray(asRecord(detail.script).bindings);
  return settingsBindings.length > 0 ? settingsBindings : scriptBindings;
}

function observabilityRecord(detail: WorkerDetail | null): Record<string, unknown> {
  if (!detail) return {};
  const scriptSettingsObservability = asRecord(detail.script_settings.data).observability;
  if (scriptSettingsObservability) return asRecord(scriptSettingsObservability);
  return asRecord(asRecord(detail.script).observability);
}

function observabilitySummary(value: unknown) {
  const observability = asRecord(value);
  const logs = asRecord(observability.logs);
  return {
    enabled: getBool(observability, "enabled"),
    logsEnabled: getBool(logs, "enabled"),
    invocationLogs: getBool(logs, "invocation_logs"),
    headSamplingRate: getOptionalNumber(observability, "head_sampling_rate") ?? getOptionalNumber(logs, "head_sampling_rate"),
  };
}

function observabilityEnabled(value: unknown): boolean | undefined {
  return observabilitySummary(value).enabled;
}

function sectionDataArray(section: RemoteSection | undefined, preferredKey: string): unknown[] {
  if (!section?.data) return [];
  if (Array.isArray(section.data)) return section.data;
  const data = asRecord(section.data);
  return asArray(data[preferredKey]);
}

function formatCompact(value: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatPercent(value: number) {
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function formatMicroseconds(value: number) {
  if (!value) return "0 us";
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} ms`;
  return `${value.toFixed(0)} us`;
}

function SectionError({ section }: { section?: RemoteSection }) {
  if (!section?.error) return null;
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700">
      {section.error}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1 leading-6">{body}</p>
    </div>
  );
}

function workerPrimaryUrl(worker: WorkerSummary) {
  const domain = worker.domains
    .map((item) => getString(item, "hostname") ?? getString(item, "domain"))
    .find(Boolean);
  if (domain) return `https://${domain}`;
  return worker.workers_dev_url;
}

function bindingLabel(binding: unknown) {
  const type = getString(binding, "type") ?? "binding";
  const name = getString(binding, "name") ?? getString(binding, "binding") ?? getString(binding, "namespace_name") ?? getString(binding, "queue_name");
  return name ? `${type}: ${name}` : type;
}

function workerHealthBadge(worker: WorkerSummary, t: ReturnType<typeof useI18n>["t"]) {
  const metrics = worker.recent_metrics;
  if (!metrics) {
    return <Badge variant="outline">{t("workers.healthUnknown")}</Badge>;
  }
  if (metrics.errors > 0) {
    return <Badge variant="destructive">{t("workers.recentErrors", { count: formatCompact(metrics.errors) })}</Badge>;
  }
  if (metrics.requests > 0) {
    return <Badge variant="secondary">{t("workers.healthy1h")}</Badge>;
  }
  return <Badge variant="outline">{t("workers.noRecentTraffic")}</Badge>;
}

function WorkerListItem({
  worker,
  accountId,
  selected,
  onSelect,
}: {
  worker: WorkerSummary;
  accountId: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const hasTraffic = worker.domains.length > 0 || worker.routes.length > 0;
  const workerObservabilityEnabled = observabilityEnabled(worker.observability);
  const primaryUrl = workerPrimaryUrl(worker);
  const bindingSummary = worker.bindings.slice(0, 3).map(bindingLabel);
  const extraBindings = Math.max(0, worker.bindings.length - bindingSummary.length);
  const recentMetrics = worker.recent_metrics;

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-background p-4 transition-colors hover:bg-muted/40",
        selected && "border-primary/50 bg-primary/5"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <button className="min-w-0 flex-1 text-left" onClick={onSelect}>
          <span className="block truncate text-sm font-semibold">{worker.name}</span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">
            {t("workers.updatedAt", { date: dateLabel(worker.modified_on ?? worker.created_on, t("common.unknown")) })}
          </span>
        </button>
        {hasTraffic ? <Badge variant="secondary">{t("workers.traffic")}</Badge> : <Badge variant="outline">workers.dev</Badge>}
      </div>
      <button className="mt-2 block max-w-full truncate font-mono text-[11px] text-muted-foreground" onClick={onSelect}>
        {primaryUrl ?? t("workers.noVisibleUrl")}
      </button>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge variant="outline">{t("workers.bindingsCount", { count: worker.bindings.length })}</Badge>
        <Badge variant="outline">{t("workers.domainsCount", { count: worker.domains.length })}</Badge>
        <Badge variant="outline">{t("workers.routesCount", { count: worker.routes.length })}</Badge>
        <Badge variant={workerObservabilityEnabled === true ? "secondary" : "outline"}>
          {workerObservabilityEnabled === true ? t("workers.observabilityOn") : t("workers.observabilityOff")}
        </Badge>
        {workerHealthBadge(worker, t)}
      </div>
      {recentMetrics && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("workers.oneHourRequests", {
            requests: formatCompact(recentMetrics.requests),
            successes: formatCompact(Math.max(0, recentMetrics.requests - recentMetrics.errors)),
          })}
        </p>
      )}
      <div className="mt-3 grid gap-1">
        {bindingSummary.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("workers.noVisibleBindings")}</p>
        ) : (
          bindingSummary.map((label, index) => (
            <p key={`${label}-${index}`} className="truncate text-xs text-muted-foreground">
              {label}
            </p>
          ))
        )}
        {extraBindings > 0 && <p className="text-xs text-muted-foreground">{t("workers.moreBindings", { count: extraBindings })}</p>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onSelect}>
          {t("common.details")}
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          title={t("workers.copyUrl")}
          disabled={!primaryUrl}
          onClick={() => primaryUrl && writeText(primaryUrl, { label: "CFDesk" })}
        >
          <Clipboard size={14} />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8" title={t("workers.openDashboard")} onClick={() => open(dashboardUrl(accountId, worker.name))}>
          <ExternalLink size={14} />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8" title={t("workers.openDocs")} onClick={() => open(WORKERS_DOCS_URL)}>
          <Workflow size={14} />
        </Button>
      </div>
    </div>
  );
}

function WorkersSummaryPanel({ overview }: { overview: WorkersOverview | null }) {
  const { t } = useI18n();
  const domainCount = overview?.workers.reduce((sum, worker) => sum + worker.domains.length, 0) ?? 0;
  const routeCount = overview?.workers.reduce((sum, worker) => sum + worker.routes.length, 0) ?? 0;
  const bindingCount = overview?.workers.reduce((sum, worker) => sum + worker.bindings.length, 0) ?? 0;
  const recentErrorCount = overview?.workers.reduce((sum, worker) => sum + (worker.recent_metrics?.errors ?? 0), 0) ?? 0;
  const workersWithErrors = overview?.workers.filter((worker) => (worker.recent_metrics?.errors ?? 0) > 0).length ?? 0;

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      <div className="rounded-lg border border-border bg-background p-4">
        <p className="text-2xl font-semibold">{overview?.workers.length ?? "—"}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("workers.title")}</p>
      </div>
      <div className="rounded-lg border border-border bg-background p-4">
        <p className="text-2xl font-semibold">{formatCompact(recentErrorCount)}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("workers.summary.withRecentErrors", { count: workersWithErrors })}</p>
      </div>
      <div className="rounded-lg border border-border bg-background p-4">
        <p className="text-2xl font-semibold">{domainCount}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("workers.summary.customDomains")}</p>
      </div>
      <div className="rounded-lg border border-border bg-background p-4">
        <p className="text-2xl font-semibold">{routeCount}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("workers.filter.routes")}</p>
      </div>
      <div className="rounded-lg border border-border bg-background p-4">
        <p className="text-2xl font-semibold">{bindingCount}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("workers.summary.visibleBindings")}</p>
      </div>
    </div>
  );
}

function WorkerDetailView({
  detail,
  loading,
  onRefresh,
  onNavigate,
}: {
  detail: WorkerDetail | null;
  loading: boolean;
  onRefresh: () => void;
  onNavigate: (id: string) => void;
}) {
  const { t } = useI18n();
  const [secretName, setSecretName] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [secretStatus, setSecretStatus] = useState<"idle" | "saving" | "deleting">("idle");
  const [subdomainStatus, setSubdomainStatus] = useState<"idle" | "saving">("idle");
  const [cronStatus, setCronStatus] = useState<"idle" | "saving">("idle");
  const [tailStatus, setTailStatus] = useState<"idle" | "starting">("idle");
  const [observabilityStatus, setObservabilityStatus] = useState<"idle" | "saving">("idle");
  const [metricsStatus, setMetricsStatus] = useState<"idle" | "loading" | "error">("idle");
  const [metricsRange, setMetricsRange] = useState(60);
  const [metrics, setMetrics] = useState<WorkerMetrics | null>(null);
  const [domainStatus, setDomainStatus] = useState<"idle" | "saving" | "deleting">("idle");
  const [routeStatus, setRouteStatus] = useState<"idle" | "saving" | "deleting">("idle");
  const [cronDraft, setCronDraft] = useState("");
  const [tailResult, setTailResult] = useState<unknown>(null);
  const [domainHostname, setDomainHostname] = useState("");
  const [domainZoneId, setDomainZoneId] = useState("");
  const [domainZoneName, setDomainZoneName] = useState("");
  const [domainEnvironment, setDomainEnvironment] = useState("production");
  const [routePattern, setRoutePattern] = useState("");
  const [routeZoneId, setRouteZoneId] = useState("");
  const [observabilityEnabledDraft, setObservabilityEnabledDraft] = useState(true);
  const [observabilitySamplingDraft, setObservabilitySamplingDraft] = useState("1");
  const [invocationLogsEnabledDraft, setInvocationLogsEnabledDraft] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const workerName = detail ? (getString(detail.script, "id") ?? getString(detail.script, "name") ?? "worker") : "";
  const metricSummary = useMemo(() => summarizeWorkerMetricRows(metrics?.rows), [metrics]);
  const currentObservability = useMemo(() => observabilitySummary(observabilityRecord(detail)), [detail]);

  useEffect(() => {
    setSecretName("");
    setSecretValue("");
    setTailResult(null);
    setMetrics(null);
    setDomainHostname("");
    setDomainZoneId("");
    setDomainZoneName("");
    setDomainEnvironment("production");
    setRoutePattern("");
    setRouteZoneId("");
    setMessage(null);
    setError(null);
  }, [detail?.script]);

  useEffect(() => {
    const schedules = sectionDataArray(detail?.schedules, "schedules");
    setCronDraft(
      schedules
        .map((schedule) => getString(schedule, "cron"))
        .filter((cron): cron is string => Boolean(cron))
        .join("\n")
    );
  }, [detail]);

  useEffect(() => {
    const summary = observabilitySummary(observabilityRecord(detail));
    setObservabilityEnabledDraft(summary.enabled !== false);
    setObservabilitySamplingDraft(String(summary.headSamplingRate ?? 1));
    setInvocationLogsEnabledDraft(summary.invocationLogs !== false);
  }, [detail]);

  useEffect(() => {
    if (!workerName) return;
    let cancelled = false;
    setMetricsStatus("loading");
    fetchWorkerMetrics(workerName, metricsRange)
      .then((data) => {
        if (cancelled) return;
        setMetrics(data);
        setMetricsStatus("idle");
      })
      .catch((metricsError) => {
        if (cancelled) return;
        setMetrics(null);
        setMetricsStatus("error");
        setError(String(metricsError));
      });
    return () => {
      cancelled = true;
    };
  }, [metricsRange, workerName]);

  if (!detail) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
        {t("workers.selectPrompt")}
      </div>
    );
  }

  const workerUrl = detail.account_subdomain ? `https://${workerName}.${detail.account_subdomain}.workers.dev` : undefined;
  const bindings = workerBindings(detail);
  const deployments = sectionDataArray(detail.deployments, "deployments");
  const versions = sectionDataArray(detail.versions, "versions");
  const secrets = sectionDataArray(detail.secrets, "secrets");
  const schedules = sectionDataArray(detail.schedules, "schedules");
  const tails = sectionDataArray(detail.tails, "tails");
  const routes = asArray(asRecord(detail.script).routes);
  const workersDevEnabled = getBool(detail.subdomain.data, "enabled");

  const saveSecret = async () => {
    if (!secretName.trim() || !secretValue) return;
    const confirmed = window.confirm(t("workers.confirm.saveSecret", { name: secretName.trim(), worker: workerName }));
    if (!confirmed) return;
    setSecretStatus("saving");
    setMessage(null);
    setError(null);
    try {
      await upsertWorkerSecret(workerName, secretName.trim(), secretValue);
      setMessage(t("workers.secretSaved"));
      setSecretValue("");
      onRefresh();
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setSecretStatus("idle");
    }
  };

  const removeSecret = async (name: string) => {
    const confirmed = window.confirm(t("workers.confirm.deleteSecret", { name, worker: workerName }));
    if (!confirmed) return;
    setSecretStatus("deleting");
    setMessage(null);
    setError(null);
    try {
      await deleteWorkerSecret(workerName, name);
      setMessage(t("workers.secretDeleted"));
      onRefresh();
    } catch (deleteError) {
      setError(String(deleteError));
    } finally {
      setSecretStatus("idle");
    }
  };

  const toggleWorkersDev = async () => {
    const nextEnabled = workersDevEnabled !== true;
    const confirmed = window.confirm(
      t("workers.confirm.toggleWorkersDev", {
        action: nextEnabled ? t("workers.action.enable") : t("workers.action.disable"),
        worker: workerName,
      })
    );
    if (!confirmed) return;
    setSubdomainStatus("saving");
    setMessage(null);
    setError(null);
    try {
      await setWorkerSubdomain(workerName, nextEnabled, true);
      setMessage(nextEnabled ? t("workers.workersDevEnabled") : t("workers.workersDevDisabled"));
      onRefresh();
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setSubdomainStatus("idle");
    }
  };

  const saveCronTriggers = async () => {
    const crons = cronDraft
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const confirmed = window.confirm(t("workers.confirm.replaceCron", { worker: workerName, count: crons.length }));
    if (!confirmed) return;
    setCronStatus("saving");
    setMessage(null);
    setError(null);
    try {
      await updateWorkerSchedules(workerName, crons);
      setMessage(t("workers.cronUpdated"));
      onRefresh();
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setCronStatus("idle");
    }
  };

  const createTailSession = async () => {
    setTailStatus("starting");
    setMessage(null);
    setError(null);
    try {
      const data = await startWorkerTail(workerName);
      setTailResult(data);
      setMessage(t("workers.tailCreated"));
      onRefresh();
    } catch (tailError) {
      setError(String(tailError));
    } finally {
      setTailStatus("idle");
    }
  };

  const saveObservabilitySettings = async () => {
    const samplingRate = Number(observabilitySamplingDraft);
    if (!Number.isFinite(samplingRate) || samplingRate < 0 || samplingRate > 1) {
      setError(t("workers.samplingError"));
      return;
    }
    const confirmed = window.confirm(
      t("workers.confirm.observability", { worker: workerName })
    );
    if (!confirmed) return;
    setObservabilityStatus("saving");
    setMessage(null);
    setError(null);
    try {
      await updateWorkerObservability(
        workerName,
        observabilityEnabledDraft,
        samplingRate,
        invocationLogsEnabledDraft
      );
      setMessage(t("workers.observabilityUpdated"));
      onRefresh();
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setObservabilityStatus("idle");
    }
  };

  const refreshMetrics = async () => {
    setMetricsStatus("loading");
    setError(null);
    try {
      const data = await fetchWorkerMetrics(workerName, metricsRange);
      setMetrics(data);
      setMetricsStatus("idle");
    } catch (metricsError) {
      setMetrics(null);
      setMetricsStatus("error");
      setError(String(metricsError));
    }
  };

  const saveCustomDomain = async () => {
    const hostname = domainHostname.trim();
    if (!hostname) return;
    const confirmed = window.confirm(t("workers.confirm.attachDomain", { hostname, worker: workerName }));
    if (!confirmed) return;
    setDomainStatus("saving");
    setMessage(null);
    setError(null);
    try {
      await attachWorkerDomain(
        workerName,
        hostname,
        domainZoneId.trim() || undefined,
        domainZoneName.trim() || undefined,
        domainEnvironment.trim() || undefined
      );
      setMessage(t("workers.domainAttached"));
      setDomainHostname("");
      onRefresh();
    } catch (domainError) {
      setError(String(domainError));
    } finally {
      setDomainStatus("idle");
    }
  };

  const removeCustomDomain = async (domain: unknown) => {
    const id = getString(domain, "id");
    const hostname = getString(domain, "hostname") ?? getString(domain, "domain") ?? id;
    if (!id) {
      setError(t("workers.domainDeleteNeedsId"));
      return;
    }
    const confirmed = window.confirm(t("workers.confirm.detachDomain", { hostname: hostname ?? "", worker: workerName }));
    if (!confirmed) return;
    setDomainStatus("deleting");
    setMessage(null);
    setError(null);
    try {
      await detachWorkerDomain(id);
      setMessage(t("workers.domainDetached"));
      onRefresh();
    } catch (domainError) {
      setError(String(domainError));
    } finally {
      setDomainStatus("idle");
    }
  };

  const saveRoute = async () => {
    const zoneId = routeZoneId.trim();
    const pattern = routePattern.trim();
    if (!zoneId || !pattern) return;
    const confirmed = window.confirm(t("workers.confirm.attachRoute", { pattern, worker: workerName }));
    if (!confirmed) return;
    setRouteStatus("saving");
    setMessage(null);
    setError(null);
    try {
      await attachWorkerRoute(workerName, zoneId, pattern);
      setMessage(t("workers.routeAttached"));
      setRoutePattern("");
      onRefresh();
    } catch (routeError) {
      setError(String(routeError));
    } finally {
      setRouteStatus("idle");
    }
  };

  const removeRoute = async (route: unknown) => {
    const routeId = getString(route, "id");
    const zoneId = getString(route, "zone_id") ?? routeZoneId.trim();
    const pattern = getString(route, "pattern") ?? routeId;
    if (!routeId || !zoneId) {
      setError(t("workers.routeDeleteNeedsIds"));
      return;
    }
    const confirmed = window.confirm(t("workers.confirm.detachRoute", { pattern: pattern ?? "", worker: workerName }));
    if (!confirmed) return;
    setRouteStatus("deleting");
    setMessage(null);
    setError(null);
    try {
      await detachWorkerRoute(zoneId, routeId);
      setMessage(t("workers.routeDetached"));
      onRefresh();
    } catch (routeError) {
      setError(String(routeError));
    } finally {
      setRouteStatus("idle");
    }
  };

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="rounded-lg border border-border bg-background p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold tracking-tight">{workerName}</h2>
              {workersDevEnabled === false ? <Badge variant="outline">{t("workers.workersDevOff")}</Badge> : <Badge variant="secondary">{t("workers.remoteWorker")}</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("workers.updatedAt", { date: dateLabel(getString(detail.script, "modified_on") ?? getString(detail.script, "created_on"), t("common.unknown")) })}
            </p>
            {workerUrl && <p className="mt-2 truncate font-mono text-xs text-muted-foreground">{workerUrl}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => writeText(`wrangler tail ${workerName}`, { label: "CFDesk" })}>
              <Terminal size={14} className="mr-2" />
              {t("workers.copyTail")}
            </Button>
            {workerUrl && (
              <Button variant="outline" size="sm" onClick={() => writeText(workerUrl, { label: "CFDesk" })}>
                <Clipboard size={14} className="mr-2" />
                {t("workers.copyUrl")}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => open(dashboardUrl(detail.account_id, workerName))}>
              <ExternalLink size={14} className="mr-2" />
              {t("workers.workerDashboard")}
            </Button>
            <Button variant="ghost" size="icon" onClick={onRefresh} disabled={loading}>
              {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            </Button>
          </div>
        </div>
      </div>

      {message && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700">{message}</div>}
      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}

      <Tabs defaultValue="overview" className="min-h-0">
        <TabsList className="mb-4 flex h-auto flex-wrap justify-start gap-1 bg-muted/50 p-1">
          <TabsTrigger value="overview">{t("workers.tab.overview")}</TabsTrigger>
          <TabsTrigger value="metrics">{t("workers.tab.metrics")}</TabsTrigger>
          <TabsTrigger value="logs">{t("workers.tab.logs")}</TabsTrigger>
          <TabsTrigger value="deployments">{t("workers.tab.deployments")}</TabsTrigger>
          <TabsTrigger value="bindings">{t("workers.tab.bindings")}</TabsTrigger>
          <TabsTrigger value="secrets">{t("workers.tab.secrets")}</TabsTrigger>
          <TabsTrigger value="domains">{t("workers.tab.domains")}</TabsTrigger>
          <TabsTrigger value="cron">{t("workers.tab.cron")}</TabsTrigger>
          <TabsTrigger value="settings">{t("workers.tab.settings")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-0 grid gap-4 xl:grid-cols-2">
          <div className="rounded-lg border border-border bg-background p-4">
            <h3 className="text-sm font-semibold">{t("workers.overview.trafficTitle")}</h3>
            <div className="mt-3 grid gap-2">
              {workerUrl && <p className="truncate font-mono text-xs text-muted-foreground">{workerUrl}</p>}
              {detail.domains.map((domain, index) => (
                <p key={index} className="truncate font-mono text-xs text-muted-foreground">
                  {getString(domain, "hostname") ?? getString(domain, "domain") ?? JSON.stringify(domain)}
                </p>
              ))}
              {routes.map((route, index) => (
                <p key={index} className="truncate font-mono text-xs text-muted-foreground">
                  {getString(route, "pattern") ?? JSON.stringify(route)}
                </p>
              ))}
              {!workerUrl && detail.domains.length === 0 && routes.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("workers.overview.noTraffic")}</p>
              )}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-background p-4">
            <h3 className="text-sm font-semibold">{t("workers.overview.riskTitle")}</h3>
            <div className="mt-3 grid gap-2">
              <Badge variant={currentObservability.enabled === true ? "secondary" : "outline"}>
                {t("workers.logs.title")} {currentObservability.enabled === true ? t("common.enabled") : t("common.notEnabled")}
              </Badge>
              <Badge variant={metricSummary.errors > 0 ? "destructive" : "secondary"}>
                {t("workers.recentErrors", { count: formatCompact(metricSummary.errors) })}
              </Badge>
              <Badge variant={deployments.length > 0 ? "secondary" : "outline"}>{t("workers.overview.deploymentsCount", { count: deployments.length })}</Badge>
              <Badge variant={versions.length > 0 ? "secondary" : "outline"}>{t("workers.overview.versionsCount", { count: versions.length })}</Badge>
              <Badge variant={bindings.length > 0 ? "secondary" : "outline"}>{t("workers.bindingsCount", { count: bindings.length })}</Badge>
              <Badge variant={secrets.length > 0 ? "secondary" : "outline"}>{t("workers.overview.secretsCount", { count: secrets.length })}</Badge>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="metrics" className="mt-0 grid gap-4">
          <SectionError section={detail.script_settings} />
          <div className="rounded-lg border border-border bg-background p-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="flex items-start gap-3">
                  <Workflow size={16} className="mt-0.5 text-primary" />
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold">{t("workers.metrics.title")}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {t("workers.metrics.body")}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {METRIC_RANGES.map((range) => (
                    <Button
                      key={range.minutes}
                      variant={metricsRange === range.minutes ? "default" : "outline"}
                      size="sm"
                      onClick={() => setMetricsRange(range.minutes)}
                    >
                      {range.label}
                    </Button>
                  ))}
                  <Button variant="outline" size="sm" onClick={refreshMetrics} disabled={metricsStatus === "loading"}>
                    {metricsStatus === "loading" ? <Loader2 size={14} className="mr-2 animate-spin" /> : <RefreshCw size={14} className="mr-2" />}
                    {t("common.refresh")}
                  </Button>
                </div>
              </div>

              {metricsStatus === "error" && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {t("workers.metrics.error")}
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-7">
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">{t("workers.metrics.requests")}</p>
                  <p className="mt-1 text-xl font-semibold">{formatCompact(metricSummary.requests)}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">{t("workers.metrics.successes")}</p>
                  <p className="mt-1 text-xl font-semibold">{formatCompact(metricSummary.successes)}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">{t("workers.metrics.errors")}</p>
                  <p className="mt-1 text-xl font-semibold">{formatCompact(metricSummary.errors)}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">{t("workers.metrics.errorRate")}</p>
                  <p className="mt-1 text-xl font-semibold">
                    {metricSummary.requests > 0 ? formatPercent((metricSummary.errors / metricSummary.requests) * 100) : "0%"}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">CPU P50</p>
                  <p className="mt-1 text-xl font-semibold">{formatMicroseconds(metricSummary.cpuP50)}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">CPU P99</p>
                  <p className="mt-1 text-xl font-semibold">{formatMicroseconds(metricSummary.cpuP99)}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">{t("workers.metrics.subrequests")}</p>
                  <p className="mt-1 text-xl font-semibold">{formatCompact(metricSummary.subrequests)}</p>
                </div>
              </div>

              <div className="grid gap-3 xl:grid-cols-2">
                <div className="rounded-lg border border-border bg-background p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{t("workers.metrics.invocationStatus")}</p>
                    <Badge variant="outline">{metrics?.rows.length ?? 0} rows</Badge>
                  </div>
                  <div className="mt-3 grid gap-2">
                    {Array.from(metricSummary.statuses.entries()).length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t("workers.metrics.noRows")}</p>
                    ) : (
                      Array.from(metricSummary.statuses.entries()).map(([status, requests]) => (
                        <div key={status} className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-3 py-2 text-sm">
                          <span>{status}</span>
                          <span className="font-mono">{formatCompact(requests)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-background p-3">
                  <p className="text-sm font-medium">{t("workers.metrics.cloudflareTools")}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => open(dashboardUrl(detail.account_id, workerName))}>
                      <ExternalLink size={14} className="mr-2" />
                      {t("workers.metrics.openWorkerDashboard")}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => open(WORKERS_METRICS_DOCS_URL)}>
                      {t("common.docs")}
                    </Button>
                  </div>
                  {metrics && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      {dateLabel(metrics.start, t("common.unknown"))} - {dateLabel(metrics.end, t("common.unknown"))}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="logs" className="mt-0 grid gap-4">
          <SectionError section={detail.script_settings} />
          <SectionError section={detail.tails} />
          <div className="rounded-lg border border-border bg-background p-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">{t("workers.logs.title")}</h3>
                    <Badge variant={currentObservability.enabled === true ? "secondary" : "outline"}>
                      {currentObservability.enabled === true ? t("common.enabled") : t("common.notEnabled")}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {t("workers.logs.body")}
                  </p>
                </div>
                <Button onClick={saveObservabilitySettings} disabled={observabilityStatus === "saving"}>
                  {observabilityStatus === "saving" ? <Loader2 size={14} className="mr-2 animate-spin" /> : <ShieldCheck size={14} className="mr-2" />}
                  {t("workers.logs.save")}
                </Button>
              </div>

              <div className="grid gap-3 lg:grid-cols-[1fr_180px_1fr]">
                <label className="flex items-start justify-between gap-3 rounded-md border border-border bg-muted/20 p-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{t("workers.logs.workersLogs")}</span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      {t("workers.logs.workersLogsBody")}
                    </span>
                  </span>
                  <Switch checked={observabilityEnabledDraft} onCheckedChange={setObservabilityEnabledDraft} />
                </label>
                <div className="rounded-md border border-border bg-muted/20 p-3">
                  <label className="block text-xs font-medium text-muted-foreground">{t("workers.logs.samplingRate")}</label>
                  <Input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={observabilitySamplingDraft}
                    onChange={(event) => setObservabilitySamplingDraft(event.target.value)}
                    className="mt-2"
                  />
                </div>
                <label className="flex items-start justify-between gap-3 rounded-md border border-border bg-muted/20 p-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{t("workers.logs.invocationLogs")}</span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      {t("workers.logs.invocationLogsBody")}
                    </span>
                  </span>
                  <Switch checked={invocationLogsEnabledDraft} onCheckedChange={setInvocationLogsEnabledDraft} />
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{t("workers.logs.badgeLogs", { state: currentObservability.logsEnabled === false ? t("common.off") : t("common.onOrDefault") })}</Badge>
                <Badge variant="outline">{t("workers.logs.badgeInvocations", { state: currentObservability.invocationLogs === false ? t("common.off") : t("common.onOrDefault") })}</Badge>
                <Badge variant="outline">{t("workers.logs.badgeSampling", { value: currentObservability.headSamplingRate ?? 1 })}</Badge>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-background p-4">
            <div className="flex items-start gap-3">
              <Terminal size={16} className="mt-0.5 text-primary" />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{t("workers.logs.tailTitle")}</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {t("workers.logs.tailBody")}
                </p>
                <code className="mt-3 block rounded-md bg-muted px-3 py-2 font-mono text-xs">wrangler tail {workerName}</code>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => writeText(`wrangler tail ${workerName}`, { label: "CFDesk" })}>
                    <Clipboard size={14} className="mr-2" />
                    {t("workers.logs.copyCommand")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={createTailSession} disabled={tailStatus === "starting"}>
                    {tailStatus === "starting" ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Terminal size={14} className="mr-2" />}
                    {t("workers.logs.startApiTail")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => open(WORKERS_LOGS_DOCS_URL)}>
                    {t("workers.logs.docs")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => open(dashboardUrl(detail.account_id, workerName))}>
                    <ExternalLink size={14} className="mr-2" />
                    {t("workers.logs.openObservability")}
                  </Button>
                </div>
                {tailResult !== null && (
                  <pre className="mt-3 max-h-56 overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
                    {JSON.stringify(tailResult, null, 2)}
                  </pre>
                )}
                {tails.length > 0 && (
                  <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
                    {JSON.stringify(tails, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="deployments" className="mt-0 grid gap-3">
          <SectionError section={detail.deployments} />
          <SectionError section={detail.versions} />
          {deployments.length === 0 ? (
            <EmptyState title={t("workers.deployments.emptyTitle")} body={t("workers.deployments.emptyBody")} />
          ) : (
            deployments.map((deployment, index) => (
              <div key={index} className="rounded-lg border border-border bg-background p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-mono text-xs">{getString(deployment, "id") ?? `deployment-${index + 1}`}</p>
                  <Badge variant="outline">{getString(deployment, "source") ?? t("workers.tab.deployments")}</Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("workers.deployments.createdAt", { date: dateLabel(getString(deployment, "created_on") ?? getString(deployment, "created_on_ms"), t("common.unknown")) })}
                </p>
                <pre className="mt-3 max-h-56 overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
                  {JSON.stringify(deployment, null, 2)}
                </pre>
              </div>
            ))
          )}
          <div className="rounded-lg border border-border bg-background p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">{t("workers.deployments.versions")}</h3>
              <Badge variant="outline">{versions.length}</Badge>
            </div>
            {versions.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">{t("workers.deployments.noVersions")}</p>
            ) : (
              <div className="mt-3 grid gap-2">
                {versions.map((version, index) => (
                  <pre key={index} className="max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
                    {JSON.stringify(version, null, 2)}
                  </pre>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-muted-foreground">
            {t("workers.deployments.rollbackWarning")}
          </div>
        </TabsContent>

        <TabsContent value="bindings" className="mt-0 grid gap-3">
          <SectionError section={detail.settings} />
          {bindings.length === 0 ? (
            <EmptyState title={t("workers.bindings.emptyTitle")} body={t("workers.bindings.emptyBody")} />
          ) : (
            bindings.map((binding, index) => {
              const type = getString(binding, "type") ?? "binding";
              const name = getString(binding, "name") ?? getString(binding, "binding") ?? `binding-${index + 1}`;
              const target =
                type.includes("d1")
                  ? "d1"
                  : type.includes("r2")
                    ? "r2"
                    : type.includes("kv")
                      ? "kv"
                      : type.includes("queue")
                        ? "queues"
                        : null;
              return (
                <div key={`${name}-${index}`} className="rounded-lg border border-border bg-background p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{type}</p>
                    </div>
                    {target && (
                      <Button variant="outline" size="sm" onClick={() => onNavigate(target)}>
                        {t("workers.bindings.openResource")}
                      </Button>
                    )}
                  </div>
                  <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
                    {JSON.stringify(binding, null, 2)}
                  </pre>
                </div>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="secrets" className="mt-0 grid gap-4">
          <SectionError section={detail.secrets} />
          <div className="rounded-lg border border-border bg-background p-4">
            <div className="flex items-start gap-3">
              <LockKeyhole size={16} className="mt-0.5 text-primary" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold">{t("workers.secrets.title")}</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {t("workers.secrets.body")}
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-[220px_1fr_auto]">
                  <Input value={secretName} onChange={(event) => setSecretName(event.target.value)} placeholder={t("workers.secrets.namePlaceholder")} />
                  <Input value={secretValue} onChange={(event) => setSecretValue(event.target.value)} placeholder={t("workers.secrets.valuePlaceholder")} type="password" />
                  <Button onClick={saveSecret} disabled={!secretName.trim() || !secretValue || secretStatus === "saving"}>
                    {secretStatus === "saving" ? <Loader2 size={14} className="mr-2 animate-spin" /> : <ShieldCheck size={14} className="mr-2" />}
                    {t("common.save")}
                  </Button>
                </div>
              </div>
            </div>
          </div>
          {secrets.length === 0 ? (
            <EmptyState title={t("workers.secrets.emptyTitle")} body={t("workers.secrets.emptyBody")} />
          ) : (
            <div className="grid gap-2">
              {secrets.map((secret, index) => {
                const name = getString(secret, "name") ?? getString(secret, "binding") ?? `secret-${index + 1}`;
                return (
                  <div key={`${name}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm">{name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{t("workers.secrets.valueHidden")}</p>
                    </div>
                    <Button variant="destructive" size="sm" onClick={() => removeSecret(name)} disabled={secretStatus === "deleting"}>
                      <Trash2 size={14} className="mr-2" />
                      {t("common.delete")}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="domains" className="mt-0 grid gap-4 xl:grid-cols-2">
          <div className="rounded-lg border border-border bg-background p-4 xl:col-span-2">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Globe size={16} className="text-primary" />
                  <h3 className="text-sm font-semibold">{t("workers.domains.workersDevRoute")}</h3>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {workerUrl ?? t("workers.domains.noSubdomain")}
                </p>
              </div>
              <Button variant="outline" onClick={toggleWorkersDev} disabled={subdomainStatus === "saving"}>
                {subdomainStatus === "saving" && <Loader2 size={14} className="mr-2 animate-spin" />}
                {workersDevEnabled === true ? t("workers.domains.disableWorkersDev") : t("workers.domains.enableWorkersDev")}
              </Button>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-background p-4">
            <div className="flex items-center gap-2">
              <Globe size={16} className="text-primary" />
              <h3 className="text-sm font-semibold">{t("workers.domains.customDomains")}</h3>
            </div>
            <div className="mt-3 grid gap-2">
              <Input value={domainHostname} onChange={(event) => setDomainHostname(event.target.value)} placeholder="app.example.com" />
              <div className="grid gap-2 md:grid-cols-3">
                <Input value={domainZoneId} onChange={(event) => setDomainZoneId(event.target.value)} placeholder={t("workers.domains.zoneId")} />
                <Input value={domainZoneName} onChange={(event) => setDomainZoneName(event.target.value)} placeholder={t("workers.domains.zoneName")} />
                <Input value={domainEnvironment} onChange={(event) => setDomainEnvironment(event.target.value)} placeholder={t("workers.domains.environment")} />
              </div>
              <Button onClick={saveCustomDomain} disabled={!domainHostname.trim() || domainStatus === "saving"} className="w-fit">
                {domainStatus === "saving" && <Loader2 size={14} className="mr-2 animate-spin" />}
                {t("workers.domains.attachDomain")}
              </Button>
            </div>
            <div className="mt-3 grid gap-2">
              {detail.domains.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("workers.domains.noCustomDomains")}</p>
              ) : (
                detail.domains.map((domain, index) => {
                  const label = getString(domain, "hostname") ?? getString(domain, "domain") ?? JSON.stringify(domain);
                  const id = getString(domain, "id");
                  return (
                    <div key={id ?? index} className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-3 py-2">
                      <p className="min-w-0 truncate font-mono text-xs text-muted-foreground">{label}</p>
                      <Button variant="destructive" size="sm" onClick={() => removeCustomDomain(domain)} disabled={!id || domainStatus === "deleting"}>
                        <Trash2 size={14} className="mr-2" />
                        {t("workers.domains.detach")}
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-background p-4">
            <div className="flex items-center gap-2">
              <Route size={16} className="text-primary" />
              <h3 className="text-sm font-semibold">{t("workers.filter.routes")}</h3>
            </div>
            <div className="mt-3 grid gap-2">
              <Input value={routeZoneId} onChange={(event) => setRouteZoneId(event.target.value)} placeholder={t("workers.domains.zoneId")} />
              <Input value={routePattern} onChange={(event) => setRoutePattern(event.target.value)} placeholder="example.com/api/*" />
              <Button onClick={saveRoute} disabled={!routeZoneId.trim() || !routePattern.trim() || routeStatus === "saving"} className="w-fit">
                {routeStatus === "saving" && <Loader2 size={14} className="mr-2 animate-spin" />}
                {t("workers.domains.attachRoute")}
              </Button>
            </div>
            <div className="mt-3 grid gap-2">
              {routes.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("workers.domains.noRoutes")}</p>
              ) : (
                routes.map((route, index) => {
                  const label = getString(route, "pattern") ?? JSON.stringify(route);
                  const id = getString(route, "id");
                  const zoneId = getString(route, "zone_id") ?? routeZoneId.trim();
                  return (
                    <div key={id ?? index} className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-3 py-2">
                      <p className="min-w-0 truncate font-mono text-xs text-muted-foreground">{label}</p>
                      <Button variant="destructive" size="sm" onClick={() => removeRoute(route)} disabled={!id || !zoneId || routeStatus === "deleting"}>
                        <Trash2 size={14} className="mr-2" />
                        {t("workers.domains.detach")}
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-muted-foreground xl:col-span-2">
            {t("workers.domains.warning")}
          </div>
        </TabsContent>

        <TabsContent value="cron" className="mt-0 grid gap-3">
          <SectionError section={detail.schedules} />
          <div className="rounded-lg border border-border bg-background p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h3 className="text-sm font-semibold">{t("workers.cron.title")}</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {t("workers.cron.body")}
                </p>
              </div>
              <Button onClick={saveCronTriggers} disabled={cronStatus === "saving"}>
                {cronStatus === "saving" ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Clock size={14} className="mr-2" />}
                {t("workers.cron.save")}
              </Button>
            </div>
            <Textarea
              value={cronDraft}
              onChange={(event) => setCronDraft(event.target.value)}
              className="mt-3 min-h-32 font-mono text-xs"
              placeholder="*/30 * * * *"
            />
          </div>
          {schedules.length === 0 ? (
            <EmptyState title={t("workers.cron.emptyTitle")} body={t("workers.cron.emptyBody")} />
          ) : (
            schedules.map((schedule, index) => (
              <div key={index} className="rounded-lg border border-border bg-background p-4">
                <div className="flex items-center gap-2">
                  <Clock size={16} className="text-primary" />
                  <p className="font-mono text-sm">{getString(schedule, "cron") ?? JSON.stringify(schedule)}</p>
                </div>
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="settings" className="mt-0 grid gap-4 xl:grid-cols-2">
          <SectionError section={detail.settings} />
          <SectionError section={detail.script_settings} />
          <div className="rounded-lg border border-border bg-background p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">{t("workers.settings.workerTitle")}</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {t("workers.settings.workerBody")}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => open(dashboardUrl(detail.account_id, workerName))}>
                <ExternalLink size={14} className="mr-2" />
                {t("workers.settings.dashboard")}
              </Button>
            </div>
            <pre className="mt-3 max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
              {JSON.stringify(detail.settings.data ?? {}, null, 2)}
            </pre>
          </div>
          <div className="rounded-lg border border-border bg-background p-4">
            <h3 className="text-sm font-semibold">{t("workers.settings.scriptTitle")}</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {t("workers.settings.scriptBody")}
            </p>
            <pre className="mt-3 max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
              {JSON.stringify(detail.script_settings.data ?? {}, null, 2)}
            </pre>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function WorkersView({ onNavigate }: WorkersViewProps) {
  const { t } = useI18n();
  const [overview, setOverview] = useState<WorkersOverview | null>(null);
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkerDetail | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [detailStatus, setDetailStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const data = await fetchWorkersOverview();
      setOverview(data);
      setSelectedWorker((current) => current ?? data.workers[0]?.name ?? null);
      setStatus("idle");
    } catch (loadError) {
      setError(String(loadError));
      setStatus("error");
    }
  }, []);

  const loadDetail = useCallback(async (workerName: string) => {
    setDetailStatus("loading");
    setError(null);
    try {
      const data = await fetchWorkerDetail(workerName);
      setDetail(data);
      setDetailStatus("idle");
    } catch (loadError) {
      setError(String(loadError));
      setDetailStatus("error");
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (selectedWorker) {
      loadDetail(selectedWorker);
    }
  }, [loadDetail, selectedWorker]);

  const filteredWorkers = useMemo(() => {
    const lowerQuery = query.trim().toLowerCase();
    return (overview?.workers ?? []).filter((worker) => {
      const matchesQuery = !lowerQuery || worker.name.toLowerCase().includes(lowerQuery);
      const matchesFilter =
        filter === "all" ||
        (filter === "errors" && (worker.recent_metrics?.errors ?? 0) > 0) ||
        (filter === "domains" && worker.domains.length > 0) ||
        (filter === "routes" && worker.routes.length > 0) ||
        (filter === "bindings" && worker.bindings.length > 0) ||
        (filter === "observability" && observabilityEnabled(worker.observability) !== true);
      return matchesQuery && matchesFilter;
    });
  }, [filter, overview, query]);

  return (
    <div className="flex h-full flex-col gap-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("workers.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("workers.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => open(WORKERS_DOCS_URL)}>
            <ExternalLink size={15} className="mr-2" />
            {t("common.docs")}
          </Button>
          <Button variant="outline" onClick={loadOverview} disabled={status === "loading"}>
            {status === "loading" ? <Loader2 size={15} className="mr-2 animate-spin" /> : <RefreshCw size={15} className="mr-2" />}
            {t("common.refresh")}
          </Button>
        </div>
      </div>

      {error && (
        <div className={cn("rounded-lg border p-3 text-sm", detailStatus === "error" || status === "error" ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-border bg-muted/20")}>
          {error}
        </div>
      )}
      {(overview?.subdomain_error || overview?.domains_error) && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700">
          {overview.subdomain_error || overview.domains_error}
        </div>
      )}
      {overview?.metrics_error && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700">
          {t("workers.recentMetricsError")}
        </div>
      )}

      <WorkersSummaryPanel overview={overview} />

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[360px_1fr]">
        <section className="min-h-0 overflow-hidden rounded-lg border border-border bg-muted/10">
          <div className="border-b border-border p-3">
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
              }}
            >
              <div className="relative flex-1">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("workers.search")} className="h-9 pl-8" />
              </div>
            </form>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["all", "errors", "domains", "routes", "bindings", "observability"] as FilterMode[]).map((item) => (
                <Button
                  key={item}
                  size="sm"
                  variant={filter === item ? "default" : "outline"}
                  onClick={() => setFilter(item)}
                >
                  {t(FILTER_LABEL_KEYS[item])}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid max-h-full gap-2 overflow-y-auto p-3">
            {status === "loading" && !overview ? (
              <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">
                <Loader2 size={16} className="mr-2 animate-spin" />
                {t("workers.loading")}
              </div>
            ) : filteredWorkers.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">{t("workers.noFilterResults")}</p>
            ) : (
              filteredWorkers.map((worker) => (
                <WorkerListItem
                  key={worker.name}
                  worker={worker}
                  accountId={overview?.account_id ?? ""}
                  selected={selectedWorker === worker.name}
                  onSelect={() => setSelectedWorker(worker.name)}
                />
              ))
            )}
          </div>
        </section>

        <section className="min-h-0 overflow-y-auto">
          <WorkerDetailView
            detail={detail}
            loading={detailStatus === "loading"}
            onRefresh={() => {
              if (selectedWorker) {
                loadDetail(selectedWorker);
              }
            }}
            onNavigate={onNavigate}
          />
        </section>
      </div>
    </div>
  );
}
