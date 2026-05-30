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

const DOCS_URL = "https://developers.cloudflare.com/workers/development-testing/local-explorer/";

const commands = [
  {
    label: "Start local Worker",
    value: "npx wrangler dev",
  },
  {
    label: "Open Explorer",
    value: "http://localhost:8787/cdn-cgi/explorer",
  },
  {
    label: "OpenAPI endpoint",
    value: "curl http://localhost:8787/cdn-cgi/explorer/api",
  },
];

const capabilities = [
  { icon: KeyRound, title: "KV", body: "Browse, create, update, and delete local key-value data." },
  { icon: PackageOpen, title: "R2", body: "List objects, inspect metadata, upload files, and delete objects." },
  { icon: Database, title: "D1", body: "Browse tables, inspect rows, run SQL, and edit local data through SQL." },
  { icon: ServerCog, title: "Durable Objects", body: "Inspect SQLite storage for local Durable Object instances." },
  { icon: Workflow, title: "Workflows", body: "Inspect local instances, step history, status, and retry runs." },
];

async function copy(value: string) {
  await writeText(value, { label: "CFDesk" });
}

export function LocalExplorerView() {
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
            <Badge variant="secondary">Official Cloudflare tool</Badge>
            <Badge variant="outline">Local development</Badge>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Local Explorer</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Cloudflare Local Explorer is the official local binding browser for
            `wrangler dev`. Use it to inspect local KV, R2, D1, Durable Objects,
            and Workflows data while CFDesk stays focused on remote account
            resources.
          </p>
        </div>
        <Button variant="outline" onClick={() => open(DOCS_URL)}>
          <BookOpen size={15} className="mr-2" />
          Official docs
        </Button>
      </div>

      <section className="grid gap-3 rounded-lg border border-border bg-muted/20 p-4 md:grid-cols-[1.2fr_1fr]">
        <div>
          <h2 className="text-sm font-semibold">Open in your local Worker</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Run `npx wrangler dev` in your project. Press `e` in the Wrangler
            terminal, or open the Explorer URL below.
          </p>
          <div className="mt-4 flex max-w-md items-center gap-2">
            <Input
              value={port}
              onChange={(event) => setPort(event.target.value.replace(/[^\d]/g, ""))}
              className="h-9 w-28"
              aria-label="Local Wrangler port"
            />
            <Button variant="outline" onClick={() => open(explorerUrl)}>
              <ExternalLink size={15} className="mr-2" />
              Open URL
            </Button>
            <Button variant="ghost" size="icon" onClick={() => copy(explorerUrl)} title="Copy URL">
              <Clipboard size={15} />
            </Button>
          </div>
          <p className="mt-2 font-mono text-xs text-muted-foreground">{explorerUrl}</p>
        </div>
        <div className="rounded-md border border-border bg-background p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Link2 size={15} className="text-primary" />
            API endpoint
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            `/cdn-cgi/explorer/api` exposes an OpenAPI spec for local binding
            data. It is useful for automation tools that need structured local
            development data.
          </p>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        {commands.map((item) => (
          <div key={item.value} className="rounded-lg border border-border bg-background p-4">
            <p className="text-sm font-medium">{item.label}</p>
            <code className="mt-3 block overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs">
              {item.value}
            </code>
            <Button className="mt-3 h-8" variant="outline" onClick={() => copy(item.value)}>
              <Clipboard size={14} className="mr-2" />
              Copy
            </Button>
          </div>
        ))}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Supported local bindings</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {capabilities.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-lg border border-border bg-background p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Icon size={15} className="text-primary" />
                {title}
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-muted/20 p-4">
        <div className="flex items-start gap-3">
          <Play size={16} className="mt-0.5 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">When to use it</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Use Local Explorer when you are debugging data created by
              `wrangler dev`. Use CFDesk when you need to inspect or maintain
              remote Cloudflare resources in the selected account.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
