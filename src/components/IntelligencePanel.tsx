import { AlertCircle, CheckCircle2, Zap, Database, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { D1AnalysisResult } from "@/hooks/useQueryExecutor";
import { useI18n } from "@/lib/i18n";

interface IntelligencePanelProps {
  analysis: D1AnalysisResult | null;
  requiresConfirmation: boolean;
  isMutationPreview?: boolean;
  isBlindSelectPreview?: boolean;
  previewTableName?: string | null;
  validationError?: string | null;
  onApplyFix: (sql: string) => void;
  onCancelConfirmation: () => void;
}

export function IntelligencePanel({ 
  analysis, 
  requiresConfirmation, 
  isMutationPreview,
  isBlindSelectPreview,
  previewTableName,
  validationError,
  onApplyFix, 
  onCancelConfirmation 
}: IntelligencePanelProps) {
  const { t } = useI18n();
  const isHighCost = analysis?.cost_tier === "High" || analysis?.is_full_scan;
  const isLowCost = analysis?.cost_tier === "Low" && !analysis?.is_full_scan;
  const tableName = analysis?.scanned_tables[0] || previewTableName || "table_name";

  if (!analysis && !requiresConfirmation && !isMutationPreview && !isBlindSelectPreview && !validationError) return null;

  const showDestructive = requiresConfirmation || isMutationPreview;
  const showWarning = isBlindSelectPreview || !!validationError;
  const showError = !!validationError;

  const handleCreateIndex = () => {
    const indexName = `idx_${tableName}_${Math.floor(Math.random() * 1000)}`;
    const sql = `CREATE INDEX ${indexName} ON ${tableName} (column_name);`;
    onApplyFix(sql);
  };

  return (
    <div className={cn(
      "flex flex-col gap-3 px-4 py-3 border-t transition-all duration-500 animate-in fade-in slide-in-from-bottom-2",
      showError
        ? "bg-amber-500/10 border-amber-500/30"
        : showWarning
          ? "bg-amber-500/5 border-amber-500/20"
          : showDestructive
            ? "bg-destructive/10 border-destructive/30 shadow-[0_0_15px_-5px_rgba(239,68,68,0.2)]"
            : isHighCost 
              ? "bg-destructive/5 border-destructive/20" 
              : isLowCost
                ? "bg-emerald-500/5 border-emerald-500/10"
                : "bg-muted/10 border-border"
    )}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg shadow-sm ring-1",
            showError || showWarning
              ? "bg-amber-500/10 text-amber-500 ring-amber-500/20"
              : showDestructive || isHighCost 
                ? "bg-destructive/10 text-destructive ring-destructive/20" 
                : isLowCost
                  ? "bg-emerald-500/10 text-emerald-500 ring-emerald-500/20"
                  : "bg-sky-500/10 text-sky-500 ring-sky-500/20"
          )}>
            {showError || showWarning ? <AlertCircle size={16} /> : showDestructive || isHighCost ? <AlertCircle size={16} /> : isLowCost ? <CheckCircle2 size={16} /> : <Zap size={16} />}
          </div>
          
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className={cn(
                "text-[13px] font-semibold tracking-tight",
                showError || showWarning ? "text-amber-500" : showDestructive || isHighCost ? "text-destructive" : isLowCost ? "text-emerald-500" : "text-sky-500"
              )}>
                {showError ? t("d1.intel.validation") : requiresConfirmation ? t("d1.intel.confirmDestructive") : isMutationPreview ? t("d1.intel.destructiveDetected") : isBlindSelectPreview ? t("d1.intel.blindDetected") : isHighCost ? t("d1.intel.highCost") : isLowCost ? t("d1.intel.optimized") : t("d1.intel.intelligence")}
              </span>
              {(!showError) && (
                <>
                  <div className="h-1 w-1 rounded-full bg-muted-foreground/30" />
                  <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-md bg-white/5 border border-border">
                      <Database size={10} className={cn(
                        "transition-colors",
                        showDestructive ? "text-destructive" : showWarning ? "text-amber-500" : "text-muted-foreground/60"
                      )} />
                      <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{tableName}</span>
                  </div>
                </>
              )}
            </div>
            
            <p className="text-[12px] text-muted-foreground/80 leading-relaxed mt-0.5">
              {showError ? (
                <span className="text-amber-500/90 font-medium">{validationError}</span>
              ) : requiresConfirmation ? (
                t("d1.intel.confirmBody")
              ) : isMutationPreview ? (
                t("d1.intel.mutationBody")
              ) : isBlindSelectPreview ? (
                t("d1.intel.blindBody")
              ) : isHighCost ? (
                t("d1.intel.highCostBody")
              ) : isLowCost ? (
                t("d1.intel.optimizedBody")
              ) : (
                t("d1.intel.defaultBody")
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {requiresConfirmation && (
            <Button 
              variant="ghost" 
              size="sm"
              onClick={onCancelConfirmation}
              className="h-8 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              {t("common.cancel")}
            </Button>
          )}
          {isHighCost && !requiresConfirmation && (
            <Button 
              variant="outline" 
              size="sm"
              onClick={handleCreateIndex}
              className="h-8 gap-2 text-[11px] font-bold border-destructive/20 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-all group shrink-0"
            >
              <Zap size={12} className="text-amber-500 fill-amber-500 group-hover:scale-125 transition-transform" />
              {t("d1.intel.createIndex")}
              <ArrowRight size={12} className="opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
