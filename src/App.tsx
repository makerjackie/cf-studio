import { ThemeProvider } from "@/components/ThemeProvider";
import { Layout } from "@/components/Layout";
import { SetupWizard } from "@/components/SetupWizard";
import { Toaster } from "@/components/ui/toaster";
import { useEffect, useState, lazy, Suspense } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppStore } from "@/store/useAppStore";
import { useI18n } from "@/lib/i18n";

function ProFeatureFallback() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-background text-muted-foreground p-10 text-center">
      <h1 className="text-xl font-bold mb-2">{t("app.proRequiredTitle")}</h1>
      <p className="text-sm max-w-xs">{t("app.proRequiredBody")}</p>
    </div>
  );
}

// Dynamic import for Pro-only ActivityDashboard
const ActivityDashboard = lazy(() => 
  import("@/pro_modules/ui/ActivityDashboard")
    .then(module => ({ default: module.ActivityDashboard }))
    .catch(() => ({ default: ProFeatureFallback }))
);

function App() {
  const [windowLabel, setWindowLabel] = useState<string | null>(null);

  useEffect(() => {
    try {
      setWindowLabel(getCurrentWindow().label);
    } catch {
      setWindowLabel("main");
    }
    useAppStore.getState().checkFeatureFlags();
  }, []);

  if (windowLabel === null) {
      return null;
  }

  if (windowLabel === "history") {
    return (
      <ThemeProvider defaultTheme="dark" storageKey="cf-desk-theme">
        <Suspense fallback={<div className="h-screen flex items-center justify-center bg-background"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>}>
          <ActivityDashboard />
        </Suspense>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider defaultTheme="dark" storageKey="cf-desk-theme">
      <SetupWizard>
        <Layout />
      </SetupWizard>
      <Toaster />
    </ThemeProvider>
  );
}

export default App;
