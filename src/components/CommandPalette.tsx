import { useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  ArrowRight,
  Clipboard,
  Command,
  ExternalLink,
  EyeOff,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { useAppStore, type AppLanguage } from "@/store/useAppStore";
import type { CloudflareAccount } from "@/hooks/useCloudflare";
import {
  buildAccountDashboardUrl,
  buildTokenPermissionText,
  buildWranglerEnvSnippet,
  filterStudioCommands,
  type StudioCommandLike,
} from "@/lib/studio";
import { cn } from "@/lib/utils";

interface PaletteNavItem {
  id: string;
  label: string;
  group: string;
  icon: React.ElementType;
}
interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  navItems: PaletteNavItem[];
  onNavigate: (id: string) => void;
  activeAccount: CloudflareAccount | null;
}

interface PaletteCommand extends StudioCommandLike {
  group: string;
  icon: React.ElementType;
  badge?: string;
  run: () => void | Promise<void>;
}

const COPY: Record<AppLanguage, {
  title: string;
  desc: string;
  search: string;
  empty: string;
  copied: string;
  copiedDesc: string;
  navGroup: string;
  actionGroup: string;
  docsGroup: string;
  wranglerGroup: string;
  open: string;
  copy: string;
  refresh: string;
  dashboard: string;
  dashboardDesc: string;
  apiTokens: string;
  apiTokensDesc: string;
  envSnippet: string;
  envSnippetDesc: string;
  tokenPermissions: string;
  tokenPermissionsDesc: string;
  privacy: string;
  privacyDesc: string;
  privacyOn: string;
  privacyOff: string;
  reload: string;
  reloadDesc: string;
  docsWorkers: string;
  docsD1: string;
  docsR2: string;
  docsLocalExplorer: string;
}> = {
  "en-US": {
    title: "Command Center",
    desc: "Search pages, docs, Wrangler commands, and local Studio actions.",
    search: "Search commands, resources, docs...",
    empty: "No matching commands.",
    copied: "Copied",
    copiedDesc: "Command copied to clipboard.",
    navGroup: "Navigate",
    actionGroup: "Studio Actions",
    docsGroup: "Cloudflare Docs",
    wranglerGroup: "Wrangler",
    open: "Open",
    copy: "Copy",
    refresh: "Reload app",
    dashboard: "Open Cloudflare dashboard",
    dashboardDesc: "Open the selected account in Cloudflare.",
    apiTokens: "Open API Tokens",
    apiTokensDesc: "Create or rotate Cloudflare API tokens.",
    envSnippet: "Copy Cloudflare env snippet",
    envSnippetDesc: "Copy CLOUDFLARE_API_TOKEN and account id exports.",
    tokenPermissions: "Copy token permission checklist",
    tokenPermissionsDesc: "Minimum permissions used by CFDesk.",
    privacy: "Toggle Privacy Shield",
    privacyDesc: "Blur or reveal sensitive account and resource names.",
    privacyOn: "Privacy on",
    privacyOff: "Privacy off",
    reload: "Reload CFDesk",
    reloadDesc: "Refresh local cache state and mounted views.",
    docsWorkers: "Workers docs",
    docsD1: "D1 docs",
    docsR2: "R2 docs",
    docsLocalExplorer: "Local Explorer docs",
  },
  "zh-CN": {
    title: "命令中心",
    desc: "搜索页面、文档、Wrangler 命令和本机 Studio 操作。",
    search: "搜索命令、资源、文档...",
    empty: "没有匹配的命令。",
    copied: "已复制",
    copiedDesc: "命令已复制到剪贴板。",
    navGroup: "导航",
    actionGroup: "Studio 操作",
    docsGroup: "Cloudflare 文档",
    wranglerGroup: "Wrangler",
    open: "打开",
    copy: "复制",
    refresh: "重新加载应用",
    dashboard: "打开 Cloudflare Dashboard",
    dashboardDesc: "在 Cloudflare 中打开当前账号。",
    apiTokens: "打开 API Tokens",
    apiTokensDesc: "创建或轮换 Cloudflare API Token。",
    envSnippet: "复制 Cloudflare 环境变量",
    envSnippetDesc: "复制 CLOUDFLARE_API_TOKEN 和账号 ID。",
    tokenPermissions: "复制 Token 权限清单",
    tokenPermissionsDesc: "CFDesk 使用的最低权限。",
    privacy: "切换隐私遮罩",
    privacyDesc: "模糊或显示敏感账号和资源名称。",
    privacyOn: "隐私已开",
    privacyOff: "隐私已关",
    reload: "重新加载 CFDesk",
    reloadDesc: "刷新本地缓存状态和当前视图。",
    docsWorkers: "Workers 文档",
    docsD1: "D1 文档",
    docsR2: "R2 文档",
    docsLocalExplorer: "Local Explorer 文档",
  },
};

const WRANGLER_COMMANDS = [
  { title: "wrangler login", value: "npx wrangler login", keywords: ["auth", "session"] },
  { title: "wrangler dev", value: "npx wrangler dev", keywords: ["local", "worker"] },
  { title: "wrangler deploy", value: "npx wrangler deploy", keywords: ["release", "publish"] },
  { title: "wrangler tail", value: "npx wrangler tail <worker-name>", keywords: ["logs", "workers"] },
  { title: "d1 list", value: "npx wrangler d1 list", keywords: ["database", "sql"] },
  { title: "d1 migrations", value: "npx wrangler d1 migrations list <database-name>", keywords: ["database", "schema"] },
  { title: "r2 bucket list", value: "npx wrangler r2 bucket list", keywords: ["storage", "assets"] },
  { title: "kv namespace list", value: "npx wrangler kv namespace list", keywords: ["key value"] },
  { title: "queues list", value: "npx wrangler queues list", keywords: ["messages"] },
];

const DOC_LINKS = [
  { key: "docsWorkers", url: "https://developers.cloudflare.com/workers/" },
  { key: "docsD1", url: "https://developers.cloudflare.com/d1/" },
  { key: "docsR2", url: "https://developers.cloudflare.com/r2/" },
  { key: "docsLocalExplorer", url: "https://developers.cloudflare.com/workers/development-testing/local-explorer/" },
] as const;

export function CommandPalette({
  open,
  onOpenChange,
  navItems,
  onNavigate,
  activeAccount,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const { toast } = useToast();
  const language = useAppStore((state) => state.language);
  const privacySettings = useAppStore((state) => state.privacySettings);
  const setPrivacySettings = useAppStore((state) => state.setPrivacySettings);
  const ui = COPY[language];

  const copyText = async (value: string) => {
    await writeText(value, { label: "CFDesk" });
    toast({ title: ui.copied, description: ui.copiedDesc });
  };

  const commands = useMemo<PaletteCommand[]>(() => {
    const navCommands: PaletteCommand[] = navItems.map((item) => ({
      id: `nav:${item.id}`,
      group: ui.navGroup,
      title: item.label,
      subtitle: item.group,
      keywords: [item.id, item.group],
      icon: item.icon,
      badge: ui.open,
      run: () => onNavigate(item.id),
    }));

    const actionCommands: PaletteCommand[] = [
      {
        id: "action:dashboard",
        group: ui.actionGroup,
        title: ui.dashboard,
        subtitle: ui.dashboardDesc,
        keywords: ["cloudflare", "account", "dashboard"],
        icon: ExternalLink,
        badge: ui.open,
        run: () => openExternal(buildAccountDashboardUrl(activeAccount?.id)),
      },
      {
        id: "action:api-tokens",
        group: ui.actionGroup,
        title: ui.apiTokens,
        subtitle: ui.apiTokensDesc,
        keywords: ["token", "permission", "auth"],
        icon: ExternalLink,
        badge: ui.open,
        run: () => openExternal("https://dash.cloudflare.com/profile/api-tokens"),
      },
      {
        id: "action:env",
        group: ui.actionGroup,
        title: ui.envSnippet,
        subtitle: ui.envSnippetDesc,
        keywords: ["env", "token", "account"],
        icon: Clipboard,
        badge: ui.copy,
        run: () => copyText(buildWranglerEnvSnippet(activeAccount?.id)),
      },
      {
        id: "action:permissions",
        group: ui.actionGroup,
        title: ui.tokenPermissions,
        subtitle: ui.tokenPermissionsDesc,
        keywords: ["permission", "token", "scope"],
        icon: Clipboard,
        badge: ui.copy,
        run: () => copyText(buildTokenPermissionText()),
      },
      {
        id: "action:privacy",
        group: ui.actionGroup,
        title: ui.privacy,
        subtitle: ui.privacyDesc,
        keywords: ["blur", "privacy", "demo"],
        icon: EyeOff,
        badge: privacySettings.enabled ? ui.privacyOn : ui.privacyOff,
        run: () => setPrivacySettings({ enabled: !privacySettings.enabled }),
      },
      {
        id: "action:reload",
        group: ui.actionGroup,
        title: ui.reload,
        subtitle: ui.reloadDesc,
        keywords: ["refresh", "reload"],
        icon: RefreshCw,
        badge: ui.refresh,
        run: () => window.location.reload(),
      },
    ];

    const wranglerCommands: PaletteCommand[] = WRANGLER_COMMANDS.map((item) => ({
      id: `wrangler:${item.title}`,
      group: ui.wranglerGroup,
      title: item.title,
      subtitle: item.value,
      keywords: item.keywords,
      icon: Command,
      badge: ui.copy,
      run: () => copyText(item.value),
    }));

    const docsCommands: PaletteCommand[] = DOC_LINKS.map((item) => ({
      id: `docs:${item.key}`,
      group: ui.docsGroup,
      title: ui[item.key],
      subtitle: item.url,
      keywords: ["docs", item.key],
      icon: ExternalLink,
      badge: ui.open,
      run: () => openExternal(item.url),
    }));

    return [...navCommands, ...actionCommands, ...wranglerCommands, ...docsCommands];
  }, [activeAccount?.id, navItems, onNavigate, privacySettings.enabled, setPrivacySettings, ui]);

  const filtered = useMemo(() => filterStudioCommands(commands, query).slice(0, 28), [commands, query]);

  const runCommand = async (command: PaletteCommand) => {
    await command.run();
    onOpenChange(false);
    setQuery("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl overflow-hidden p-0">
        <div className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Command size={17} className="text-primary" />
            {ui.title}
          </DialogTitle>
          <DialogDescription className="mt-1">{ui.desc}</DialogDescription>
        </div>

        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && filtered[0]) {
                  event.preventDefault();
                  runCommand(filtered[0]);
                }
              }}
              placeholder={ui.search}
              className="h-10 pl-9"
            />
          </div>
        </div>

        <div className="max-h-[58vh] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">{ui.empty}</p>
          ) : (
            <div className="space-y-1">
              {filtered.map((command) => {
                const Icon = command.icon;
                return (
                  <button
                    key={command.id}
                    onClick={() => runCommand(command)}
                    className={cn(
                      "grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md px-3 py-2.5 text-left",
                      "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    )}
                  >
                    <Icon size={16} className="text-primary" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{command.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {command.group}
                        {command.subtitle ? ` - ${command.subtitle}` : ""}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {command.badge && (
                        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                          {command.badge}
                        </Badge>
                      )}
                      <ArrowRight size={14} className="text-muted-foreground" />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground">
          <span>⌘K / Ctrl K</span>
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onOpenChange(false)}>
            Esc
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
