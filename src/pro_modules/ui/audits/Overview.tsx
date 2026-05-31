import { useI18n } from "@/lib/i18n";

export function Overview(_props: { onNavigate?: (id: string) => void }) {
  const { t } = useI18n();
  return <div className="text-sm text-muted-foreground">{t("audit.overviewUnavailable")}</div>;
}
