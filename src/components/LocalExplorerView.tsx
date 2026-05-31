import { useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-shell";
import {
  BookOpen,
  Clipboard,
  Database,
  ExternalLink,
  KeyRound,
  Link2,
  PackageOpen,
  Play,
  ServerCog,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useI18n, type TranslationKey } from "@/lib/i18n";

const DOCS_URL = "https://developers.cloudflare.com/workers/development-testing/local-explorer/";

const commands = [
  {
    labelKey: "local.command.start",
    value: "npx wrangler dev",
  },
  {
    labelKey: "local.command.open",
    value: "http://localhost:8787/cdn-cgi/explorer",
  },
  {
    labelKey: "local.command.openapi",
    value: "curl http://localhost:8787/cdn-cgi/explorer/api",
  },
] satisfies { labelKey: TranslationKey; value: string }[];

const capabilities = [
  { icon: KeyRound, title: "KV", bodyKey: "local.cap.kv" },
  { icon: PackageOpen, title: "R2", bodyKey: "local.cap.r2" },
  { icon: Database, title: "D1", bodyKey: "local.cap.d1" },
  { icon: ServerCog, title: "Durable Objects", bodyKey: "local.cap.do" },
  { icon: Workflow, title: "Workflows", bodyKey: "local.cap.workflows" },
] satisfies { icon: React.ElementType; title: string; bodyKey: TranslationKey }[];

async function copy(value: string) {
  await writeText(value, { label: "CFDesk" });
}

export function LocalExplorerView() {
  const { t } = useI18n();
  const [port, setPort] = useState("8787");
  const explorerUrl = useMemo(() => {
    const normalizedPort = port.trim() || "8787";
    return `http://localhost:${normalizedPort}/cdn-cgi/explorer`;
  }, [port]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="secondary">{t("local.badge.official")}</Badge>
            <Badge variant="outline">{t("local.badge.development")}</Badge>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("nav.localExplorer")}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {t("local.subtitle")}
          </p>
        </div>
        <Button variant="outline" onClick={() => open(DOCS_URL)}>
          <BookOpen size={15} className="mr-2" />
          {t("local.officialDocs")}
        </Button>
      </div>

      <section className="grid gap-3 rounded-lg border border-border bg-muted/20 p-4 md:grid-cols-[1.2fr_1fr]">
        <div>
          <h2 className="text-sm font-semibold">{t("local.openTitle")}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {t("local.openBody")}
          </p>
          <div className="mt-4 flex max-w-md items-center gap-2">
            <Input
              value={port}
              onChange={(event) => setPort(event.target.value.replace(/[^\d]/g, ""))}
              className="h-9 w-28"
              aria-label={t("local.portAria")}
            />
            <Button variant="outline" onClick={() => open(explorerUrl)}>
              <ExternalLink size={15} className="mr-2" />
              {t("local.openUrl")}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => copy(explorerUrl)} title={t("local.copyUrl")}>
              <Clipboard size={15} />
            </Button>
          </div>
          <p className="mt-2 font-mono text-xs text-muted-foreground">{explorerUrl}</p>
        </div>
        <div className="rounded-md border border-border bg-background p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Link2 size={15} className="text-primary" />
            {t("local.apiEndpoint")}
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {t("local.apiBody")}
          </p>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        {commands.map((item) => (
          <div key={item.value} className="rounded-lg border border-border bg-background p-4">
            <p className="text-sm font-medium">{t(item.labelKey)}</p>
            <code className="mt-3 block overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs">
              {item.value}
            </code>
            <Button className="mt-3 h-8" variant="outline" onClick={() => copy(item.value)}>
              <Clipboard size={14} className="mr-2" />
              {t("common.copy")}
            </Button>
          </div>
        ))}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">{t("local.supportedBindings")}</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {capabilities.map(({ icon: Icon, title, bodyKey }) => (
            <div key={title} className="rounded-lg border border-border bg-background p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Icon size={15} className="text-primary" />
                {title}
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{t(bodyKey)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-muted/20 p-4">
        <div className="flex items-start gap-3">
          <Play size={16} className="mt-0.5 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">{t("local.whenUseTitle")}</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {t("local.whenUseBody")}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
