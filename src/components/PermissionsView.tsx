import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, HelpCircle, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { checkCloudflarePermissions, type PermissionCheck } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

function StatusBadge({ status }: { status: PermissionCheck["status"] }) {
  const { t } = useI18n();
  if (status === "ok") {
    return <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15">{t("permissions.status.ok")}</Badge>;
  }
  if (status === "blocked") {
    return <Badge variant="destructive">{t("permissions.status.blocked")}</Badge>;
  }
  return <Badge variant="secondary">{t("permissions.status.unknown")}</Badge>;
}

function StatusIcon({ status }: { status: PermissionCheck["status"] }) {
  if (status === "ok") return <CheckCircle2 size={16} className="text-emerald-600" />;
  if (status === "blocked") return <XCircle size={16} className="text-destructive" />;
  if (status === "warning") return <AlertTriangle size={16} className="text-amber-600" />;
  return <HelpCircle size={16} className="text-muted-foreground" />;
}

export function PermissionsView() {
  const { t } = useI18n();
  const [checks, setChecks] = useState<PermissionCheck[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const nextChecks = await checkCloudflarePermissions();
      setChecks(nextChecks);
      setStatus("idle");
    } catch (err) {
      setError(String(err));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    return checks.reduce<Record<string, PermissionCheck[]>>((acc, check) => {
      acc[check.product] ||= [];
      acc[check.product].push(check);
      return acc;
    }, {});
  }, [checks]);

  return (
    <div className="flex h-full flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">{t("permissions.title")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("permissions.subtitle")}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={load} disabled={status === "loading"}>
          <RefreshCw size={14} className={cn(status === "loading" && "animate-spin")} />
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck size={18} className="mt-0.5 text-primary" />
          <div>
            <p className="text-sm font-medium">{t("permissions.safeMode")}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t("permissions.safeModeDesc")}</p>
          </div>
        </div>
      </div>

      {status === "error" && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-3">
        {Object.entries(grouped).map(([product, productChecks]) => (
          <section key={product} className="overflow-hidden rounded-lg border border-border bg-background">
            <div className="border-b border-border bg-muted/30 px-4 py-3">
              <h2 className="text-sm font-semibold">{product}</h2>
            </div>
            <div className="divide-y divide-border">
              {productChecks.map((check) => (
                <div key={`${check.product}-${check.action}`} className="grid grid-cols-[24px_120px_120px_1fr] gap-3 px-4 py-3 text-sm">
                  <StatusIcon status={check.status} />
                  <div>
                    <p className="font-medium capitalize">{check.action}</p>
                    <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{check.endpoint}</p>
                  </div>
                  <StatusBadge status={check.status} />
                  <div className="min-w-0">
                    <p className="text-muted-foreground">{check.message}</p>
                    {check.missing_permissions.length > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("permissions.required")}:{" "}
                        <span className="font-mono">{check.missing_permissions.join(", ")}</span>
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {status === "loading" && checks.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("permissions.loading")}</p>
      )}
    </div>
  );
}
