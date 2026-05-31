import { useAppStore } from "@/store/useAppStore";
import { Card } from "@/components/ui/card";
import { CloudCog } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

export function SessionRefreshModal() {
  const { t } = useI18n();
  const isRefreshingSession = useAppStore((s) => s.isRefreshingSession);
  const [show, setShow] = useState(false);

  // Slight delay to prevent flashing the modal for < 100ms refreshes
  useEffect(() => {
    if (isRefreshingSession) {
      const timer = setTimeout(() => setShow(true), 150);
      return () => clearTimeout(timer);
    } else {
      setShow(false);
    }
  }, [isRefreshingSession]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in duration-300">
      <Card className="w-full max-w-sm p-6 shadow-2xl flex flex-col items-center text-center space-y-4 border-primary/20 bg-background">
        <div className="relative flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 text-primary mb-2">
          <CloudCog size={32} className="animate-spin" style={{ animationDuration: '3s' }} />
        </div>
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">{t("session.refreshTitle")}</h2>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            {t("session.refreshBody")}
          </p>
        </div>
      </Card>
    </div>
  );
}
