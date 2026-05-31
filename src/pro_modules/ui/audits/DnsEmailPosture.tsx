import { useI18n } from "@/lib/i18n";

export function DnsEmailPosture() {
  const { t } = useI18n();
  return <div className="text-sm text-muted-foreground">{t("audit.dnsEmailUnavailable")}</div>;
}
