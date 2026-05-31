import { useCallback, useEffect, useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-shell";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Box,
  CheckCircle2,
  Clipboard,
  CloudCog,
  Command,
  Database,
  ExternalLink,
  EyeOff,
  Gauge,
  Globe,
  HardDrive,
  KeyRound,
  Loader2,
  MessageSquare,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Terminal,
  Workflow,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import appVersion from "../../package.json";
import {
  CACHE_TTL_MS,
  useAppStore,
  type AppLanguage,
} from "@/store/useAppStore";
import { useD1Databases, useR2Buckets } from "@/hooks/useCloudflare";
import {
  fetchKVNamespaces,
  fetchQueuesOverview,
  fetchWorkersOverview,
  type KVNamespace,
  type QueuesOverview,
  type WorkersOverview,
} from "@/lib/remoteResources";
import {
  buildAccountDashboardUrl,
  buildTokenPermissionText,
  buildWranglerEnvSnippet,
  calculateReleaseReadiness,
  formatRelativeAge,
  getCacheFreshness,
  type CacheFreshness,
  type StudioHealthTone,
} from "@/lib/studio";
import { cn } from "@/lib/utils";

type LoadState = "idle" | "loading" | "error";

interface StudioViewProps {
  onNavigate: (id: string) => void;
  onOpenCommandPalette: () => void;
}

const COPY: Record<AppLanguage, {
  title: string;
  subtitle: string;
  commandCenter: string;
  refresh: string;
  refreshing: string;
  accountReady: string;
  accountMissing: string;
  accountBody: string;
  dashboard: string;
  envSnippet: string;
  permissions: string;
  copied: string;
  copiedDesc: string;
  resourceMap: string;
  resourceMapDesc: string;
  localRunbook: string;
  localRunbookDesc: string;
  readiness: string;
  readinessDesc: string;
  cache: string;
  cacheDesc: string;
  workersHealth: string;
  workersHealthDesc: string;
  recentWorkers: string;
  recentWorkersDesc: string;
  open: string;
  copy: string;
  loaded: string;
  cached: string;
  stale: string;
  notLoaded: string;
  noWorkers: string;
  remoteError: string;
  privacyOn: string;
  privacyOff: string;
  releaseReady: string;
  releaseNeedsWork: string;
  localFirst: string;
  localFirstDesc: string;
  tokenCheck: string;
  tokenCheckDesc: string;
  apiTokens: string;
  localExplorer: string;
  localExplorerDesc: string;
  docs: string;
  cacheFresh: string;
  cacheEmpty: string;
  cacheStale: string;
  autoUpdateOn: string;
  autoUpdateOff: string;
}> = {
  "en-US": {
    title: "CFDesk Home",
    subtitle: "One place for account status, remote resources, Wrangler runbooks, and release readiness.",
    commandCenter: "Command Center",
    refresh: "Refresh all",
    refreshing: "Refreshing...",
    accountReady: "Account connected",
    accountMissing: "No account selected",
    accountBody: "CFDesk can work from a local Wrangler session or a saved API token.",
    dashboard: "Dashboard",
    envSnippet: "Env snippet",
    permissions: "Token permissions",
    copied: "Copied",
    copiedDesc: "Text copied to clipboard.",
    resourceMap: "Resource Map",
    resourceMapDesc: "Fast entry points for the Cloudflare surfaces CFDesk can inspect.",
    localRunbook: "Local Runbook",
    localRunbookDesc: "Copy commands you usually need when switching between local and remote work.",
    readiness: "Workspace Readiness",
    readinessDesc: "Operational checks for a productive local Cloudflare session.",
    cache: "Cache Freshness",
    cacheDesc: "Persistent local cache lets the app open quickly and shows when data is old.",
    workersHealth: "Workers Health",
    workersHealthDesc: "Recent request and error signals when Account Analytics access is available.",
    recentWorkers: "Recently Updated Workers",
    recentWorkersDesc: "Scripts sorted by modification time.",
    open: "Open",
    copy: "Copy",
    loaded: "loaded",
    cached: "cached",
    stale: "stale",
    notLoaded: "not loaded",
    noWorkers: "No Workers loaded yet.",
    remoteError: "Some remote resources failed to load.",
    privacyOn: "Privacy Shield on",
    privacyOff: "Privacy Shield off",
    releaseReady: "Ready",
    releaseNeedsWork: "Needs attention",
    localFirst: "Local first",
    localFirstDesc: "Use Wrangler and Local Explorer for local bindings; use CFDesk for account resources.",
    tokenCheck: "Token check",
    tokenCheckDesc: "Open the permission matrix before any risky remote workflow.",
    apiTokens: "API Tokens",
    localExplorer: "Local Explorer",
    localExplorerDesc: "Open Cloudflare's local binding browser for wrangler dev.",
    docs: "Docs",
    cacheFresh: "Fresh",
    cacheEmpty: "Empty",
    cacheStale: "Stale",
    autoUpdateOn: "Auto update enabled",
    autoUpdateOff: "Auto update disabled",
  },
  "zh-CN": {
    title: "CFDesk Home",
    subtitle: "把账号状态、远程资源、Wrangler runbook 和发布准备度放在一个本机入口。",
    commandCenter: "命令中心",
    refresh: "全部刷新",
    refreshing: "刷新中...",
    accountReady: "账号已连接",
    accountMissing: "未选择账号",
    accountBody: "CFDesk 可以读取本机 Wrangler 登录态，也可以使用已保存的 API Token。",
    dashboard: "Dashboard",
    envSnippet: "环境变量",
    permissions: "Token 权限",
    copied: "已复制",
    copiedDesc: "内容已复制到剪贴板。",
    resourceMap: "资源地图",
    resourceMapDesc: "快速进入 CFDesk 可检查的 Cloudflare 资源界面。",
    localRunbook: "本机 Runbook",
    localRunbookDesc: "复制本机开发和远程发布之间常用的 Wrangler 命令。",
    readiness: "工作台准备度",
    readinessDesc: "检查本机 Cloudflare 会话是否适合继续操作。",
    cache: "缓存新鲜度",
    cacheDesc: "本地持久缓存让应用快速打开，并提示哪些数据已经变旧。",
    workersHealth: "Workers 健康",
    workersHealthDesc: "当 Token 有 Account Analytics 权限时显示近期请求和错误信号。",
    recentWorkers: "最近更新的 Workers",
    recentWorkersDesc: "按修改时间排序的脚本。",
    open: "打开",
    copy: "复制",
    loaded: "已加载",
    cached: "缓存",
    stale: "过期",
    notLoaded: "未加载",
    noWorkers: "还没有加载 Workers。",
    remoteError: "部分远程资源加载失败。",
    privacyOn: "隐私遮罩已开",
    privacyOff: "隐私遮罩已关",
    releaseReady: "就绪",
    releaseNeedsWork: "需要处理",
    localFirst: "本机优先",
    localFirstDesc: "本地绑定用 Wrangler 和 Local Explorer，账号资源用 CFDesk。",
    tokenCheck: "Token 检查",
    tokenCheckDesc: "执行高风险远程操作前，先打开权限矩阵确认。",
    apiTokens: "API Tokens",
    localExplorer: "Local Explorer",
    localExplorerDesc: "打开 Cloudflare 官方 wrangler dev 本地绑定浏览器。",
    docs: "文档",
    cacheFresh: "新鲜",
    cacheEmpty: "空",
    cacheStale: "过期",
    autoUpdateOn: "自动更新已开",
    autoUpdateOff: "自动更新已关",
  },
};

const LOCAL_COMMANDS = [
  {
    label: "Wrangler login",
    value: "npx wrangler login",
    body: "Refresh the machine session CFDesk can reuse.",
  },
  {
    label: "Local Worker",
    value: "npx wrangler dev",
    body: "Run a local Worker and open the Explorer with the terminal shortcut.",
  },
  {
    label: "Remote preview",
    value: "npx wrangler dev --remote",
    body: "Debug against remote services when local parity matters.",
  },
  {
    label: "Deploy Worker",
    value: "npx wrangler deploy",
    body: "Ship the current Worker project.",
  },
  {
    label: "Tail logs",
    value: "npx wrangler tail <worker-name>",
    body: "Stream production Worker logs after a change.",
  },
  {
    label: "List resources",
    value: "npx wrangler d1 list && npx wrangler r2 bucket list && npx wrangler kv namespace list",
    body: "Compare local CLI visibility with the Studio resource map.",
  },
];

const DOCS = [
  { label: "Workers", url: "https://developers.cloudflare.com/workers/" },
  { label: "D1", url: "https://developers.cloudflare.com/d1/" },
  { label: "R2", url: "https://developers.cloudflare.com/r2/" },
  { label: "Queues", url: "https://developers.cloudflare.com/queues/" },
  { label: "Local Explorer", url: "https://developers.cloudflare.com/workers/development-testing/local-explorer/" },
];

function toneClasses(tone: StudioHealthTone) {
  if (tone === "good") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  if (tone === "warning") return "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400";
  if (tone === "danger") return "border-destructive/20 bg-destructive/10 text-destructive";
  return "border-border bg-muted/30 text-muted-foreground";
}

function freshnessLabel(freshness: CacheFreshness, ui: typeof COPY[AppLanguage]) {
  if (freshness.status === "fresh") return ui.cacheFresh;
  if (freshness.status === "stale") return ui.cacheStale;
  return ui.cacheEmpty;
}

function ResourceTile({
  icon: Icon,
  label,
  count,
  badge,
  tone,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  count: number | string;
  badge: string;
  tone: StudioHealthTone;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-border bg-background p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center justify-between gap-3">
        <Icon size={17} className="text-primary" />
        <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]", toneClasses(tone))}>
          {badge}
        </Badge>
      </div>
      <p className="mt-4 text-2xl font-semibold tracking-tight">{count}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </button>
  );
}

function Panel({
  title,
  desc,
  icon: Icon,
  children,
}: {
  title: string;
  desc?: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-background">
      <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon size={15} className="text-primary" />
            <h2 className="text-sm font-semibold">{title}</h2>
          </div>
          {desc && <p className="mt-1 text-xs leading-5 text-muted-foreground">{desc}</p>}
        </div>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function StudioView({ onNavigate, onOpenCommandPalette }: StudioViewProps) {
  const { toast } = useToast();
  const language = useAppStore((state) => state.language);
  const ui = COPY[language];
  const activeAccount = useAppStore((state) => state.activeAccount);
  const userProfile = useAppStore((state) => state.userProfile);
  const privacySettings = useAppStore((state) => state.privacySettings);
  const autoUpdate = useAppStore((state) => state.autoUpdate);
  const lastFetched = useAppStore((state) => state.lastFetched);
  const r2LastFetched = useAppStore((state) => state.r2LastFetched);
  const kvLastFetched = useAppStore((state) => state.kvLastFetched);
  const pinnedD1 = useAppStore((state) => state.pinnedD1DatabaseIds);
  const pinnedR2 = useAppStore((state) => state.pinnedR2BucketKeys);
  const d1 = useD1Databases();
  const r2 = useR2Buckets();
  const [workers, setWorkers] = useState<WorkersOverview | null>(null);
  const [kv, setKV] = useState<KVNamespace[]>([]);
  const [queues, setQueues] = useState<QueuesOverview | null>(null);
  const [remoteStatus, setRemoteStatus] = useState<LoadState>("idle");
  const [remoteError, setRemoteError] = useState<string | null>(null);

  const copyText = async (value: string) => {
    await writeText(value, { label: "CFDesk" });
    toast({ title: ui.copied, description: ui.copiedDesc });
  };

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
      useAppStore.getState().setKvNamespaces(kvData);
      setRemoteStatus("idle");
    } catch (error) {
      setRemoteError(String(error));
      setRemoteStatus("error");
    }
  }, []);

  useEffect(() => {
    loadRemoteResources();
  }, [loadRemoteResources]);

  const refreshAll = () => {
    d1.refresh();
    r2.refresh();
    loadRemoteResources();
  };

  const d1Freshness = getCacheFreshness(lastFetched, CACHE_TTL_MS);
  const r2Freshness = getCacheFreshness(r2LastFetched, CACHE_TTL_MS);
  const kvFreshness = getCacheFreshness(kvLastFetched, CACHE_TTL_MS);

  const workerRecentErrors = workers?.workers.reduce((sum, worker) => sum + (worker.recent_metrics?.errors ?? 0), 0) ?? 0;
  const workerRequests = workers?.workers.reduce((sum, worker) => sum + (worker.recent_metrics?.requests ?? 0), 0) ?? 0;
  const workersWithRoutes = workers?.workers.filter((worker) => worker.routes.length + worker.domains.length > 0).length ?? 0;
  const workersWithBindings = workers?.workers.filter((worker) => worker.bindings.length > 0).length ?? 0;

  const recentlyModifiedWorkers = useMemo(() => {
    return [...(workers?.workers ?? [])]
      .sort((a, b) => {
        const aTime = new Date(a.modified_on ?? a.created_on ?? 0).getTime();
        const bTime = new Date(b.modified_on ?? b.created_on ?? 0).getTime();
        return bTime - aTime;
      })
      .slice(0, 5);
  }, [workers]);

  const readinessChecks = [
    { id: "account", passed: Boolean(activeAccount?.id) },
    { id: "user", passed: Boolean(userProfile?.email) },
    { id: "d1", passed: d1.state.status === "success" },
    { id: "r2", passed: r2.state.status === "success" },
    { id: "remote", passed: remoteStatus !== "error" },
    { id: "workers", passed: Boolean(workers) },
    { id: "privacy", passed: privacySettings.enabled },
    { id: "updates", passed: autoUpdate },
  ];
  const readiness = calculateReleaseReadiness(readinessChecks);
  const readinessTone: StudioHealthTone = readiness >= 80 ? "good" : readiness >= 55 ? "warning" : "danger";

  const resourceTiles = [
    {
      icon: Box,
      label: "R2",
      count: r2.state.status === "success" ? r2.state.data.length : "—",
      badge: r2.isFromCache ? ui.cached : ui.loaded,
      tone: r2.state.status === "success" ? "good" as const : "muted" as const,
      id: "r2",
    },
    {
      icon: Database,
      label: "D1",
      count: d1.state.status === "success" ? d1.state.data.length : "—",
      badge: d1.isFromCache ? ui.cached : ui.loaded,
      tone: d1.state.status === "success" ? "good" as const : "muted" as const,
      id: "d1",
    },
    {
      icon: KeyRound,
      label: "KV",
      count: kv.length,
      badge: kv.length > 0 ? ui.loaded : ui.notLoaded,
      tone: kv.length > 0 ? "good" as const : "muted" as const,
      id: "kv",
    },
    {
      icon: Workflow,
      label: "Workers",
      count: workers?.workers.length ?? "—",
      badge: workerRecentErrors > 0 ? `${workerRecentErrors} errors` : ui.loaded,
      tone: workerRecentErrors > 0 ? "warning" as const : workers ? "good" as const : "muted" as const,
      id: "workers",
    },
    {
      icon: MessageSquare,
      label: "Queues",
      count: queues?.queues.length ?? "—",
      badge: queues ? ui.loaded : ui.notLoaded,
      tone: queues ? "good" as const : "muted" as const,
      id: "queues",
    },
    {
      icon: ShieldCheck,
      label: ui.tokenCheck,
      count: "Open",
      badge: ui.open,
      tone: "good" as const,
      id: "permissions",
    },
  ];

  const checklist = [
    { label: activeAccount?.id ? ui.accountReady : ui.accountMissing, passed: Boolean(activeAccount?.id), action: () => open(buildAccountDashboardUrl(activeAccount?.id)) },
    { label: ui.tokenCheck, passed: Boolean(userProfile?.email || activeAccount?.id), action: () => onNavigate("permissions") },
    { label: ui.localExplorer, passed: true, action: () => onNavigate("local-explorer") },
    { label: privacySettings.enabled ? ui.privacyOn : ui.privacyOff, passed: privacySettings.enabled, action: () => onNavigate("settings") },
    { label: autoUpdate ? ui.autoUpdateOn : ui.autoUpdateOff, passed: autoUpdate, action: () => onNavigate("settings") },
  ];

  return (
    <div className="flex h-full flex-col gap-5">
      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-lg border border-border bg-background p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="gap-1">
                  <CloudCog size={12} />
                  v{appVersion.version}
                </Badge>
                <Badge variant="outline" className={privacySettings.enabled ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400" : ""}>
                  {privacySettings.enabled ? ui.privacyOn : ui.privacyOff}
                </Badge>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">{ui.title}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{ui.subtitle}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={onOpenCommandPalette}>
                <Command size={15} className="mr-2" />
                {ui.commandCenter}
              </Button>
              <Button onClick={refreshAll} disabled={remoteStatus === "loading"}>
                {remoteStatus === "loading" ? (
                  <Loader2 size={15} className="mr-2 animate-spin" />
                ) : (
                  <RefreshCw size={15} className="mr-2" />
                )}
                {remoteStatus === "loading" ? ui.refreshing : ui.refresh}
              </Button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{activeAccount?.id ? ui.accountReady : ui.accountMissing}</p>
              <p className="mt-2 truncate text-sm font-semibold">{activeAccount?.name ?? "Cloudflare"}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{userProfile?.email ?? ui.accountBody}</p>
            </div>
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{ui.readiness}</p>
              <div className="mt-2 flex items-center gap-3">
                <div className="h-2 flex-1 rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full", readinessTone === "good" ? "bg-emerald-500" : readinessTone === "warning" ? "bg-amber-500" : "bg-destructive")}
                    style={{ width: `${readiness}%` }}
                  />
                </div>
                <span className="font-mono text-sm font-semibold">{readiness}%</span>
              </div>
            </div>
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{ui.workersHealth}</p>
              <p className="mt-2 text-sm font-semibold">{workerRequests.toLocaleString()} requests</p>
              <p className="mt-1 text-xs text-muted-foreground">{workerRecentErrors.toLocaleString()} errors</p>
            </div>
          </div>

          {remoteStatus === "error" && (
            <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {ui.remoteError} {remoteError}
            </div>
          )}
        </div>

        <div className={cn("rounded-lg border p-5", toneClasses(readinessTone))}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Rocket size={17} />
                <h2 className="text-sm font-semibold">{ui.readiness}</h2>
              </div>
              <p className="mt-2 text-sm leading-6 opacity-80">{ui.readinessDesc}</p>
            </div>
            <Badge variant="outline" className="bg-background/70">
              {readiness >= 80 ? ui.releaseReady : ui.releaseNeedsWork}
            </Badge>
          </div>
          <div className="mt-4 space-y-2">
            {checklist.map((item) => (
              <button
                key={item.label}
                onClick={item.action}
                className="flex w-full items-center justify-between gap-3 rounded-md bg-background/70 px-3 py-2 text-left text-sm transition-colors hover:bg-background"
              >
                <span className="flex items-center gap-2">
                  {item.passed ? <CheckCircle2 size={14} className="text-emerald-500" /> : <AlertTriangle size={14} className="text-amber-500" />}
                  {item.label}
                </span>
                <ArrowRight size={14} className="text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {resourceTiles.map((tile) => (
          <ResourceTile
            key={tile.id}
            icon={tile.icon}
            label={tile.label}
            count={tile.count}
            badge={tile.badge}
            tone={tile.tone}
            onClick={() => onNavigate(tile.id)}
          />
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel title={ui.localRunbook} desc={ui.localRunbookDesc} icon={Terminal}>
          <div className="grid gap-3 md:grid-cols-2">
            {LOCAL_COMMANDS.map((item) => (
              <div key={item.value} className="rounded-md border border-border bg-muted/20 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.body}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => copyText(item.value)} title={ui.copy}>
                    <Clipboard size={14} />
                  </Button>
                </div>
                <code className="mt-3 block overflow-x-auto rounded-md bg-background px-3 py-2 text-xs">{item.value}</code>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title={ui.cache} desc={ui.cacheDesc} icon={HardDrive}>
          <div className="space-y-3">
            {[
              { label: "D1", freshness: d1Freshness, icon: Database },
              { label: "R2", freshness: r2Freshness, icon: Box },
              { label: "KV", freshness: kvFreshness, icon: KeyRound },
            ].map(({ label, freshness, icon: Icon }) => (
              <div key={label} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md border border-border bg-muted/20 px-3 py-2">
                <Icon size={15} className="text-primary" />
                <div>
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">{freshness.label}</p>
                </div>
                <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]", toneClasses(freshness.status === "fresh" ? "good" : freshness.status === "stale" ? "warning" : "muted"))}>
                  {freshnessLabel(freshness, ui)}
                </Badge>
              </div>
            ))}
            <div className="grid gap-3 md:grid-cols-2">
              <Button variant="outline" onClick={() => copyText(buildWranglerEnvSnippet(activeAccount?.id))}>
                <Clipboard size={14} className="mr-2" />
                {ui.envSnippet}
              </Button>
              <Button variant="outline" onClick={() => copyText(buildTokenPermissionText())}>
                <ShieldCheck size={14} className="mr-2" />
                {ui.permissions}
              </Button>
            </div>
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Panel title={ui.workersHealth} desc={ui.workersHealthDesc} icon={Gauge}>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">Requests</p>
              <p className="mt-2 text-xl font-semibold">{workerRequests.toLocaleString()}</p>
            </div>
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">Errors</p>
              <p className="mt-2 text-xl font-semibold">{workerRecentErrors.toLocaleString()}</p>
            </div>
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">Bindings / Routes</p>
              <p className="mt-2 text-xl font-semibold">{workersWithBindings} / {workersWithRoutes}</p>
            </div>
          </div>
          <div className="mt-4 divide-y divide-border rounded-md border border-border">
            {recentlyModifiedWorkers.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">{ui.noWorkers}</p>
            ) : (
              recentlyModifiedWorkers.map((worker) => (
                <button
                  key={worker.name}
                  onClick={() => onNavigate("workers")}
                  className="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/40"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{worker.name}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {formatRelativeAge(new Date(worker.modified_on ?? worker.created_on ?? 0).getTime())}
                    </span>
                  </span>
                  {(worker.recent_metrics?.errors ?? 0) > 0 ? (
                    <Badge variant="destructive">{worker.recent_metrics?.errors} errors</Badge>
                  ) : (
                    <Badge variant="secondary">{ui.loaded}</Badge>
                  )}
                </button>
              ))
            )}
          </div>
        </Panel>

        <Panel title={ui.resourceMap} desc={ui.resourceMapDesc} icon={Globe}>
          <div className="grid gap-3 md:grid-cols-2">
            <button onClick={() => onNavigate("local-explorer")} className="rounded-md border border-border bg-muted/20 p-3 text-left hover:bg-muted/40">
              <div className="flex items-center gap-2 text-sm font-medium">
                <BadgeCheck size={15} className="text-primary" />
                {ui.localExplorer}
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{ui.localExplorerDesc}</p>
            </button>
            <button onClick={() => onNavigate("permissions")} className="rounded-md border border-border bg-muted/20 p-3 text-left hover:bg-muted/40">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck size={15} className="text-primary" />
                {ui.tokenCheck}
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{ui.tokenCheckDesc}</p>
            </button>
            <button onClick={() => open("https://dash.cloudflare.com/profile/api-tokens")} className="rounded-md border border-border bg-muted/20 p-3 text-left hover:bg-muted/40">
              <div className="flex items-center gap-2 text-sm font-medium">
                <KeyRound size={15} className="text-primary" />
                {ui.apiTokens}
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{ui.accountBody}</p>
            </button>
            <button onClick={() => open(buildAccountDashboardUrl(activeAccount?.id))} className="rounded-md border border-border bg-muted/20 p-3 text-left hover:bg-muted/40">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ExternalLink size={15} className="text-primary" />
                {ui.dashboard}
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{activeAccount?.name ?? "Cloudflare"}</p>
            </button>
          </div>

          <div className="mt-4 rounded-md border border-border bg-muted/20 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <EyeOff size={15} className="text-primary" />
              {ui.localFirst}
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{ui.localFirstDesc}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="secondary">Pinned D1 {pinnedD1.length}</Badge>
              <Badge variant="secondary">Pinned R2 {pinnedR2.length}</Badge>
              <Badge variant="outline">{privacySettings.enabled ? ui.privacyOn : ui.privacyOff}</Badge>
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <BookOpen size={15} className="text-primary" />
              {ui.docs}
            </div>
            <div className="flex flex-wrap gap-2">
              {DOCS.map((item) => (
                <Button key={item.url} variant="outline" size="sm" onClick={() => open(item.url)}>
                  {item.label}
                  <ExternalLink size={12} className="ml-2" />
                </Button>
              ))}
            </div>
          </div>
        </Panel>
      </section>
    </div>
  );
}
