import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Copy, Database, Loader2, RefreshCw, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

interface HistoryItem {
  id: number;
  account_id: string;
  database_id: string;
  session_id: string;
  execution_source: string;
  table_name?: string | null;
  query_text: string;
  rows_read: number;
  result_data?: string | null;
  timestamp: string;
}

interface HistoryPage {
  items: HistoryItem[];
  total: number;
  page: number;
  pageSize: number;
}

interface HistoryStats {
  totalQueries: number;
  uniqueDatabases: number;
  totalRowsRead: number;
  latestQuery?: string | null;
}

const isTauriRuntime = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function firstLine(sql: string) {
  return sql.trim().split("\n").find(Boolean) ?? sql.trim();
}

function resultPreview(value?: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return value;
  }
}

export function ActivityDashboard() {
  const { t } = useI18n();
  const runtimeRequired = t("activity.runtimeRequired");
  const [pageData, setPageData] = useState<HistoryPage>({ items: [], total: 0, page: 1, pageSize: 50 });
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "clearing">("idle");
  const [error, setError] = useState<string | null>(null);

  const selectedItem = useMemo(
    () => pageData.items.find((item) => item.id === selectedId) ?? pageData.items[0] ?? null,
    [pageData.items, selectedId]
  );

  const load = useCallback(async (page = pageData.page) => {
    if (!isTauriRuntime) {
      setError(runtimeRequired);
      return;
    }

    setStatus("loading");
    setError(null);
    try {
      const [history, nextStats] = await Promise.all([
        invoke<HistoryPage>("get_paginated_history", {
          page,
          pageSize: pageData.pageSize,
          search: search.trim() || null,
          accountId: null,
          databaseId: null,
          sessionId: null,
        }),
        invoke<HistoryStats>("get_global_stats"),
      ]);
      setPageData(history);
      setStats(nextStats);
      setSelectedId((current) => current ?? history.items[0]?.id ?? null);
    } catch (loadError) {
      setError(String(loadError));
    } finally {
      setStatus("idle");
    }
  }, [pageData.page, pageData.pageSize, runtimeRequired, search]);

  useEffect(() => {
    load(1);
  }, []);

  const totalPages = Math.max(1, Math.ceil(pageData.total / pageData.pageSize));

  const clearHistory = async () => {
    const confirmed = window.confirm(t("activity.clearConfirm"));
    if (!confirmed) return;
    setStatus("clearing");
    setError(null);
    try {
      await invoke("clear_query_history", { accountId: null, databaseId: null });
      setSelectedId(null);
      await load(1);
    } catch (clearError) {
      setError(String(clearError));
    } finally {
      setStatus("idle");
    }
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{t("activity.title")}</h1>
          <p className="text-xs text-muted-foreground">{t("activity.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => load()} disabled={status === "loading"}>
            {status === "loading" ? <Loader2 size={14} className="mr-2 animate-spin" /> : <RefreshCw size={14} className="mr-2" />}
            {t("common.refresh")}
          </Button>
          <Button variant="destructive" size="sm" onClick={clearHistory} disabled={status === "clearing" || pageData.total === 0}>
            {status === "clearing" ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Trash2 size={14} className="mr-2" />}
            {t("activity.clear")}
          </Button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[360px_1fr] gap-0">
        <section className="flex min-h-0 flex-col border-r border-border">
          <div className="grid grid-cols-3 gap-2 border-b border-border p-3">
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-lg font-semibold">{stats?.totalQueries ?? 0}</p>
              <p className="text-xs text-muted-foreground">{t("activity.queries")}</p>
            </div>
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-lg font-semibold">{stats?.uniqueDatabases ?? 0}</p>
              <p className="text-xs text-muted-foreground">{t("activity.databases")}</p>
            </div>
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-lg font-semibold">{stats?.totalRowsRead ?? 0}</p>
              <p className="text-xs text-muted-foreground">{t("activity.rowsRead")}</p>
            </div>
          </div>

          <form
            className="border-b border-border p-3"
            onSubmit={(event) => {
              event.preventDefault();
              load(1);
            }}
          >
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("activity.search")}
                className="h-9 pl-8"
              />
            </div>
          </form>

          {error && (
            <div className="m-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {pageData.items.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">{t("activity.empty")}</p>
            ) : (
              pageData.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  className={cn(
                    "mb-2 w-full rounded-lg border border-border bg-background p-3 text-left hover:bg-muted/40",
                    selectedItem?.id === item.id && "border-primary/50 bg-primary/5"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="line-clamp-2 font-mono text-xs">{firstLine(item.query_text)}</p>
                    <Badge variant="outline">{item.execution_source}</Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Database size={12} />
                    <span className="truncate">{item.table_name || item.database_id}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{dateLabel(item.timestamp)}</p>
                </button>
              ))
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border p-3">
            <Button
              variant="outline"
              size="sm"
              disabled={pageData.page <= 1}
              onClick={() => load(pageData.page - 1)}
            >
              {t("activity.previous")}
            </Button>
            <span className="text-xs text-muted-foreground">
              {pageData.page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={pageData.page >= totalPages}
              onClick={() => load(pageData.page + 1)}
            >
              {t("activity.next")}
            </Button>
          </div>
        </section>

        <section className="min-h-0 overflow-y-auto p-5">
          {!selectedItem ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t("activity.selectQuery")}
            </div>
          ) : (
            <div className="mx-auto grid max-w-5xl gap-4">
              <div className="rounded-lg border border-border bg-background p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold">{t("activity.query")}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedItem.database_id} · {dateLabel(selectedItem.timestamp)}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => writeText(selectedItem.query_text, { label: "CFDesk" })}>
                    <Copy size={14} className="mr-2" />
                    {t("activity.copySql")}
                  </Button>
                </div>
                <pre className="mt-4 max-h-[360px] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-4 font-mono text-xs">
                  {selectedItem.query_text}
                </pre>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-lg border border-border bg-muted/20 p-4">
                  <p className="text-xs text-muted-foreground">{t("activity.rowsRead")}</p>
                  <p className="mt-1 text-lg font-semibold">{selectedItem.rows_read}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-4">
                  <p className="text-xs text-muted-foreground">{t("activity.source")}</p>
                  <p className="mt-1 truncate text-sm font-medium">{selectedItem.execution_source}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-4">
                  <p className="text-xs text-muted-foreground">{t("activity.table")}</p>
                  <p className="mt-1 truncate text-sm font-medium">{selectedItem.table_name || t("common.unknown")}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-4">
                  <p className="text-xs text-muted-foreground">{t("activity.session")}</p>
                  <p className="mt-1 truncate font-mono text-xs">{selectedItem.session_id}</p>
                </div>
              </div>

              {selectedItem.result_data && (
                <div className="rounded-lg border border-border bg-background p-4">
                  <h2 className="text-sm font-semibold">{t("activity.savedPreview")}</h2>
                  <pre className="mt-3 max-h-[420px] overflow-auto rounded-md bg-muted p-4 font-mono text-xs text-muted-foreground">
                    {resultPreview(selectedItem.result_data)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
