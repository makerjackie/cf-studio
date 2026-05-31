import { useEffect, useState, useCallback, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  CheckCircle2,
  XCircle,
  Download,
  Loader2,
  CloudCog,
  Terminal,
  Languages,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { useAppStore, type AppLanguage } from "@/store/useAppStore";

// ── Types ──────────────────────────────────────────────────────────────────────

interface DependencyStatus {
  npm_installed: boolean;
  wrangler_installed: boolean;
}

interface SetupProgress {
  message: string;
  progress_percentage: number;
}

type Phase = "checking" | "missing" | "installing" | "done" | "error";
const isTauriRuntime = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ── Component ──────────────────────────────────────────────────────────────────

interface SetupWizardProps {
  children: ReactNode;
}

export function SetupWizard({ children }: SetupWizardProps) {
  const { language, setLanguage, t } = useI18n();
  const hasCompletedOnboarding = useAppStore((state) => state.hasCompletedOnboarding);
  const completeOnboarding = useAppStore((state) => state.completeOnboarding);
  const [phase, setPhase] = useState<Phase>(isTauriRuntime ? "checking" : "done");
  const [status, setStatus] = useState<DependencyStatus | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const languageOptions: Array<{
    value: AppLanguage;
    label: string;
    description: string;
    marker: string;
  }> = [
    {
      value: "en-US",
      label: "English",
      description: t("setup.languageEnglishDesc"),
      marker: "Aa",
    },
    {
      value: "zh-CN",
      label: "简体中文",
      description: t("setup.languageChineseDesc"),
      marker: "中",
    },
  ];

  // ── Initial dependency check ─────────────────────────────────────────
  useEffect(() => {
    if (!isTauriRuntime) return;

    let cancelled = false;
    invoke<DependencyStatus>("check_dependencies")
      .then((res) => {
        if (cancelled) return;
        setStatus(res);
        if (res.npm_installed && res.wrangler_installed) {
          setPhase("done");
        } else {
          setPhase("missing");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMsg(String(err));
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Install handler ──────────────────────────────────────────────────
  const handleInstall = useCallback(async () => {
    if (!isTauriRuntime) return;

    setPhase("installing");
    setProgress(0);
    setMessage(t("setup.installStarting"));
    setErrorMsg(null);

    let unlisten: UnlistenFn | undefined;

    try {
      unlisten = await listen<SetupProgress>("setup-progress", (event) => {
        setProgress(event.payload.progress_percentage);
        setMessage(event.payload.message);
      });

      await invoke("install_dependencies");

      // Re-check to confirm
      const final_status = await invoke<DependencyStatus>("check_dependencies");
      setStatus(final_status);

      if (final_status.npm_installed && final_status.wrangler_installed) {
        setPhase("done");
      } else {
        setErrorMsg(
          "Installation completed but some tools are still unavailable. Please restart the app."
        );
        setPhase("error");
      }
    } catch (err) {
      setErrorMsg(String(err));
      setPhase("error");
    } finally {
      unlisten?.();
    }
  }, [t]);

  // ── Render: pass-through when done ───────────────────────────────────
  if (!hasCompletedOnboarding) {
    return (
      <WizardShell
        title={t("setup.onboardingTitle")}
        subtitle={t("setup.onboardingSubtitle")}
        icon={Languages}
      >
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">
              {t("setup.languagePrompt")}
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              {t("setup.languagePromptDesc")}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {languageOptions.map((option) => (
              <LanguageOption
                key={option.value}
                option={option}
                selected={language === option.value}
                onSelect={setLanguage}
              />
            ))}
          </div>

          <Button
            className="w-full gap-2 font-medium"
            size="lg"
            onClick={completeOnboarding}
          >
            {t("setup.continue")}
            <ArrowRight size={16} />
          </Button>
        </div>
      </WizardShell>
    );
  }

  if (phase === "done") return <>{children}</>;

  // ── Render: full-screen wizard ───────────────────────────────────────
  return (
    <WizardShell title={t("setup.title")} subtitle={t("setup.subtitle")} icon={CloudCog}>
        {/* ── Phase: Checking ─────────────────────────────────────── */}
        {phase === "checking" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2
              size={28}
              className="animate-spin text-primary"
              strokeWidth={2}
            />
            <p className="text-sm text-muted-foreground">
              {t("setup.checking")}
            </p>
          </div>
        )}

        {/* ── Phase: Missing ──────────────────────────────────────── */}
        {phase === "missing" && status && (
          <>
            {/* Dependency list */}
            <div className="space-y-3 mb-6">
              <DepRow
                label={t("setup.nodeNpm")}
                icon={Terminal}
                installed={status.npm_installed}
              />
              <DepRow
                label={t("setup.wrangler")}
                icon={CloudCog}
                installed={status.wrangler_installed}
              />
            </div>

            <Button
              className="w-full gap-2 font-medium"
              size="lg"
              onClick={handleInstall}
            >
              <Download size={16} />
              {t("setup.install")}
            </Button>

            <p className="mt-3 text-center text-[11px] text-muted-foreground/60">
              {t("setup.installNote")}
            </p>
          </>
        )}

        {/* ── Phase: Installing ───────────────────────────────────── */}
        {phase === "installing" && (
          <div className="space-y-4">
            {/* Progress bar */}
            <div className="relative w-full h-2.5 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full bg-primary",
                  "transition-[width] duration-500 ease-out"
                )}
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Percentage + message */}
            <div className="flex items-center justify-between">
              <p className="text-sm text-foreground font-medium">
                {progress}%
              </p>
              <p className="text-xs text-muted-foreground truncate max-w-[70%] text-right">
                {message || t("setup.installStarting")}
              </p>
            </div>

            {/* Spinner row */}
            <div className="flex items-center gap-2 text-muted-foreground pt-2">
              <Loader2
                size={14}
                className="animate-spin"
                strokeWidth={2}
              />
              <span className="text-xs">
                {t("setup.installingNote")}
              </span>
            </div>
          </div>
        )}

        {/* ── Phase: Error ────────────────────────────────────────── */}
        {phase === "error" && (
          <div className="space-y-4">
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <p className="text-sm text-destructive font-medium mb-1">
                {t("setup.failed")}
              </p>
              <p className="text-xs text-destructive/80 break-words">
                {errorMsg}
              </p>
            </div>

            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={handleInstall}
            >
              <Download size={16} />
              {t("setup.retry")}
            </Button>
          </div>
        )}
    </WizardShell>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function WizardShell({
  title,
  subtitle,
  icon: Icon,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ElementType;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background px-4">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:44px_44px] opacity-30" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 border-b border-border/50 bg-card/40" />

      <div className="relative w-full max-w-lg rounded-xl border border-border bg-card p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Icon size={22} className="text-primary" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              {title}
            </h1>
            <p className="text-xs text-muted-foreground">
              {subtitle}
            </p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function LanguageOption({
  option,
  selected,
  onSelect,
}: {
  option: {
    value: AppLanguage;
    label: string;
    description: string;
    marker: string;
  };
  selected: boolean;
  onSelect: (language: AppLanguage) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(option.value)}
      className={cn(
        "group flex min-h-[118px] flex-col justify-between rounded-lg border p-4 text-left transition-colors",
        selected
          ? "border-primary bg-primary/10 text-foreground shadow-sm"
          : "border-border bg-background/80 text-foreground hover:border-primary/50 hover:bg-muted/40"
      )}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-md border border-border/60 bg-card text-sm font-semibold">
          {option.marker}
        </span>
        <span
          className={cn(
            "h-4 w-4 rounded-full border transition-colors",
            selected ? "border-primary bg-primary shadow-[inset_0_0_0_3px_var(--card)]" : "border-muted-foreground/40"
          )}
        />
      </span>
      <span className="space-y-1">
        <span className="block text-sm font-semibold">
          {option.label}
        </span>
        <span className="block text-xs leading-5 text-muted-foreground">
          {option.description}
        </span>
      </span>
    </button>
  );
}

function DepRow({
  label,
  icon: Icon,
  installed,
}: {
  label: string;
  icon: React.ElementType;
  installed: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors",
        installed
          ? "border-emerald-500/20 bg-emerald-500/5"
          : "border-destructive/20 bg-destructive/5"
      )}
    >
      <Icon
        size={16}
        className={cn(
          "shrink-0",
          installed ? "text-emerald-500" : "text-destructive"
        )}
        strokeWidth={1.75}
      />
      <span className="flex-1 text-sm font-medium text-foreground">
        {label}
      </span>
      {installed ? (
        <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
      ) : (
        <XCircle size={16} className="text-destructive shrink-0" />
      )}
    </div>
  );
}
