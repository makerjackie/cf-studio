import { useI18n } from "@/lib/i18n";

export function AuditPreferences() {
  const { t } = useI18n();
  return <div className="text-sm text-muted-foreground">{t("audit.preferencesUnavailable")}</div>;
}
