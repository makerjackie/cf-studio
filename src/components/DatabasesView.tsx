// DatabasesView.tsx
//
// D1 Databases listing page — auto-fetches from the Cloudflare API.
// Clicking a row drills into DatabaseExplorer for schema inspection.

import { useState, useEffect } from "react";
import { RefreshCw, Database, Terminal, AlertCircle, Loader2, HardDrive, ChevronRight, History } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { useD1Databases, type D1Database, invokeCloudflare } from "@/hooks/useCloudflare";
import { DatabaseExplorer } from "@/components/DatabaseExplorer";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useToast } from "@/components/ui/use-toast";
import { ProFeatureGate } from "@/pro_modules/frontend/ProFeatureGate";
import { useI18n } from "@/lib/i18n";

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(iso?: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "—";
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ── Sub-components ─────────────────────────────────────────────────────────────



function LoadingSkeleton() {
  return (
    <div className="w-full space-y-0 rounded-lg border border-border overflow-hidden">
      <div className="grid grid-cols-4 border-b border-border bg-muted/40 px-4 py-2.5">
        {["Name", "Database ID", "Created At", "Size"].map((h) => (
          <div key={h} className="h-3.5 w-16 rounded bg-muted animate-pulse" />
        ))}
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="grid grid-cols-4 border-b border-border px-4 py-3.5 last:border-0">
          <div className="h-3.5 w-32 rounded bg-muted/60 animate-pulse" />
          <div className="h-3.5 w-48 rounded bg-muted/40 animate-pulse" />
          <div className="h-3.5 w-28 rounded bg-muted/40 animate-pulse" />
          <div className="h-3.5 w-12 rounded bg-muted/40 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

interface EmptyStateProps {
  variant: "no-auth" | "no-databases" | "api-error" | "not-enabled";
  message?: string;
  onRefresh: () => void;
  accountId?: string | null;
}

function EmptyState({ variant, message, onRefresh, accountId }: EmptyStateProps) {
  const { toast } = useToast();
  const { t } = useI18n();
  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText("npx wrangler login");
      toast({
        title: t("common.copied"),
        description: t("d1.toast.loginCopied"),
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleRunCommand = async () => {
    toast({
      title: t("d1.empty.openingTerminal"),
      description: t("d1.empty.openingTerminalDesc"),
    });
    try {
      await invokeCloudflare("run_wrangler_login");
    } catch (e) {
      toast({
        title: t("d1.empty.launchFailed"),
        description: String(e),
        variant: "destructive",
      });
      console.error(e);
    }
  };

  const configs = {
    "no-auth": {
      icon: Terminal,
      iconColor: "text-amber-400",
      title: t("d1.empty.noAuthTitle"),
      body: (
        <>
          {t("d1.empty.noAuthBody")}
          <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-border bg-muted/60 px-3 py-2 font-mono text-sm text-foreground">
            <span className="select-text">npx wrangler login</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopyCommand} title={t("d1.empty.copyCommand")}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
            </Button>
          </div>
          <Button variant="secondary" size="sm" className="w-full mt-3" onClick={handleRunCommand}>
            <Terminal size={14} className="mr-2" />
            {t("d1.empty.runCommand")}
          </Button>
          {message && (
            <p className="mt-3 text-xs text-destructive/80 select-text break-all">
              {message}
            </p>
          )}
        </>
      ),
    },
    "no-databases": {
      icon: Database,
      iconColor: "text-muted-foreground",
      title: t("d1.empty.noDatabasesTitle"),
      body: (
        <>
          {t("d1.empty.noDatabasesBody")}
          <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-muted/60 px-3 py-2 font-mono text-sm text-foreground">
            <span className="select-text">wrangler d1 create my-database</span>
          </div>
        </>
      ),
    },
    "not-enabled": {
      icon: Database,
      iconColor: "text-blue-500",
      title: t("d1.empty.notEnabledTitle"),
      body: (
        <>
          {t("d1.empty.notEnabledBody")}
          <div className="mt-5 flex items-center justify-center">
            <Button
              onClick={() => {
                if (accountId) openUrl(`https://dash.cloudflare.com/${accountId}/workers/d1`);
              }}
              size="sm"
            >
              {t("d1.empty.enableD1")}
            </Button>
          </div>
        </>
      ),
    },
    "api-error": {
      icon: AlertCircle,
      iconColor: "text-destructive",
      title: t("d1.empty.apiErrorTitle"),
      body: (
        <p className="text-sm text-muted-foreground select-text break-all">
          {message ?? t("d1.empty.unknownApiError")}
        </p>
      ),
    },
  };

  const { icon: Icon, iconColor, title, body } = configs[variant];

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[320px] text-center gap-5 px-6">
      <div className={cn("rounded-xl border border-border bg-muted/30 p-4", iconColor)}>
        <Icon size={28} strokeWidth={1.5} />
      </div>
      <div className="max-w-sm space-y-2">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <div className="text-sm text-muted-foreground leading-relaxed text-left">{body}</div>
      </div>
      <Button variant="outline" size="sm" onClick={onRefresh} className="gap-1.5 mt-1">
        <RefreshCw size={13} strokeWidth={2} />
        {t("common.refresh")}
      </Button>
    </div>
  );
}

// ── Database row ───────────────────────────────────────────────────────────────

interface DatabaseRowProps {
  db: D1Database;
  onClick: (db: D1Database) => void;
}

function DatabaseRow({ db, onClick }: DatabaseRowProps) {
  const privacySettings = useAppStore(s => s.privacySettings);
  const blurDb = privacySettings.enabled && privacySettings.databaseNames;

  return (
    <TableRow
      onClick={() => onClick(db)}
      className="group cursor-pointer hover:bg-accent/40 transition-colors"
    >
      {/* Name */}
      <TableCell className="font-medium text-foreground py-3.5">
        <div className="flex items-center gap-2">
          <Database size={13} strokeWidth={1.75} className="text-primary shrink-0" />
          <span className={cn(
            "truncate max-w-[200px]", 
            blurDb && "blur-[4px] hover:blur-none transition-all duration-200 select-none hover:select-auto cursor-default"
          )}>
            {db.name}
          </span>
        </div>
      </TableCell>

      {/* ID */}
      <TableCell className="py-3.5">
        <code className={cn(
          "text-xs bg-muted/60 px-2 py-0.5 rounded font-mono text-muted-foreground select-text",
          privacySettings.enabled && privacySettings.databaseIds && "blur-[4px] hover:blur-none transition-all duration-200 select-none hover:select-auto cursor-default"
        )}>
          {db.uuid}
        </code>
      </TableCell>

      {/* Created */}
      <TableCell className="text-sm text-muted-foreground py-3.5 whitespace-nowrap">
        {formatDate(db.created_at)}
      </TableCell>

      {/* Tables */}
      <TableCell className="py-3.5">
        <Badge variant="secondary" className="font-mono text-[10px] uppercase tracking-wide">
          {new Intl.NumberFormat("en-US").format(db.num_tables ?? 0)}
        </Badge>
      </TableCell>

      {/* Size */}
      <TableCell className="text-sm text-muted-foreground py-3.5">
        <div className="flex items-center gap-1.5">
          <HardDrive size={12} strokeWidth={1.75} className="text-muted-foreground/50 shrink-0" />
          {formatBytes(db.file_size)}
        </div>
      </TableCell>

      {/* Chevron hint */}
      <TableCell className="py-3.5 w-6 pr-3">
        <ChevronRight
          size={13}
          strokeWidth={1.75}
          className="text-muted-foreground/30 group-hover:text-muted-foreground transition-colors"
        />
      </TableCell>
    </TableRow>
  );
}

// ── Database list view ─────────────────────────────────────────────────────────

interface DatabaseListProps {
  onSelect: (db: D1Database) => void;
}

function DatabaseList({ onSelect }: DatabaseListProps) {
  const { t } = useI18n();
  const { state, refresh } = useD1Databases();
  const activeAccount = useAppStore((s) => s.activeAccount);
  const enableD1History = useAppStore((s) => s.enableD1History);
  const isLoading = state.status === "loading" || state.status === "idle";
  const [hasProHistory, setHasProHistory] = useState(false);
  const [isPurchaseOpen, setIsPurchaseOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    // Check if the Pro History module exists on disk (compilation check)
    import("@/pro_modules/ui/ActivityDashboard")
      .then(() => setHasProHistory(true))
      .catch(() => setHasProHistory(false));
  }, []);

  return (
    <div className="flex flex-col gap-5 h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">{t("d1.title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("d1.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                  if (!enableD1History) {
                      setIsPurchaseOpen(true);
                      return;
                  }

                  if (!hasProHistory) {
                      toast({
                        title: t("d1.historyRequired"),
                        description: t("d1.historyRequiredDesc"),
                        variant: "destructive",
                      });
                      return;
                  }
                  console.log("Opening history window...");
                  const storedTheme = localStorage.getItem("cf-studio-theme") || "dark";
                  const historyUrl = `index.html?theme=${encodeURIComponent(storedTheme)}`;
                  const webview = new WebviewWindow("history", {
                      url: historyUrl,
                      title: t("d1.queryHistory"),
                      width: 1200,
                      height: 800,
                      minWidth: 600,
                      minHeight: 400,
                  });
                  
                  webview.once("tauri://created", () => {
                     console.log("History window created successfully");
                     webview.show();
                     webview.setFocus();
                  });

                  webview.once("tauri://error", (e) => {
                     console.error("Failed to create history window:", e);
                     WebviewWindow.getByLabel("history").then(win => {
                         if (win) {
                             win.show();
                             win.setFocus();
                         }
                     });
                  });
              }}
              title={enableD1History && hasProHistory ? t("d1.queryHistory") : t("d1.queryHistoryPro")}
              className="text-muted-foreground hover:text-foreground"
            >
              <History size={15} strokeWidth={2} />
            </Button>
            {(!enableD1History || !hasProHistory) && (
              <span className="absolute -top-1 -right-1 px-1 bg-amber-500 text-[8px] font-bold text-white rounded-sm pointer-events-none scale-75 uppercase">
                {t("common.pro")}
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            disabled={isLoading}
            aria-label={t("common.refresh")}
            className="text-muted-foreground hover:text-foreground"
          >
            <RefreshCw size={14} strokeWidth={2} className={cn(isLoading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {isLoading && <LoadingSkeleton />}

        {state.status === "error" &&
          (state.message.toLowerCase().includes("10023") ||
            state.message.toLowerCase().includes("10036") ||
            state.message.toLowerCase().includes("enable d1")) && (
            <EmptyState variant="not-enabled" accountId={activeAccount?.id} onRefresh={refresh} />
          )}

        {state.status === "error" &&
          !(state.message.toLowerCase().includes("10023") || state.message.toLowerCase().includes("10036") || state.message.toLowerCase().includes("enable d1")) &&
          (state.message.toLowerCase().includes("wrangler") ||
            state.message.toLowerCase().includes("oauth") ||
            state.message.toLowerCase().includes("not found")) && (
            <EmptyState variant="no-auth" message={state.message} onRefresh={refresh} />
          )}

        {state.status === "error" &&
          !(state.message.toLowerCase().includes("10023") || state.message.toLowerCase().includes("10036") || state.message.toLowerCase().includes("enable d1")) &&
          !state.message.toLowerCase().includes("wrangler") &&
          !state.message.toLowerCase().includes("oauth") &&
          !state.message.toLowerCase().includes("not found") && (
            <EmptyState variant="api-error" message={state.message} onRefresh={refresh} />
          )}

        {state.status === "success" && state.data.length === 0 && (
          <EmptyState variant="no-databases" onRefresh={refresh} />
        )}

        {state.status === "success" && state.data.length > 0 && (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  {[t("d1.table.name"), t("d1.table.id"), t("d1.table.createdAt"), t("d1.table.tables"), t("d1.table.size"), ""].map((h) => (
                    <TableHead
                      key={h}
                      className="text-xs font-medium uppercase tracking-wider text-muted-foreground py-2.5"
                    >
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.data.map((db) => (
                  <DatabaseRow key={db.uuid} db={db} onClick={onSelect} />
                ))}
              </TableBody>
            </Table>

            <div className="flex items-center gap-1.5 border-t border-border bg-muted/20 px-4 py-2">
              <Loader2 size={11} className="text-muted-foreground/40 hidden" />
              <span className="text-xs text-muted-foreground/60">
                {t(state.data.length === 1 ? "d1.listFooterSingular" : "d1.listFooter", { count: state.data.length })}
              </span>
            </div>
          </div>
        )}
      </div>

      <ProFeatureGate 
        isOpen={isPurchaseOpen} 
        onClose={() => setIsPurchaseOpen(false)} 
        featureName="history"
      />
    </div>
  );
}

// ── Root view — manages selected database state ────────────────────────────────

export function DatabasesView() {
  const [selectedDb, setSelectedDb] = useState<D1Database | null>(null);

  if (selectedDb) {
    return (
      <DatabaseExplorer
        database={selectedDb}
        onBack={() => setSelectedDb(null)}
      />
    );
  }

  return <DatabaseList onSelect={setSelectedDb} />;
}
