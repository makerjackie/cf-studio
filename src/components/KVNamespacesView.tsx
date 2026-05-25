import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Braces,
  Clipboard,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteKVEntry,
  fetchKVNamespaces,
  getKVEntry,
  listKVKeys,
  putKVEntry,
  type KVEntry,
  type KVKey,
  type KVNamespace,
} from "@/lib/remoteResources";
import { cn } from "@/lib/utils";

function formatExpiration(value?: number | string | null) {
  if (!value) return "No TTL";
  const seconds = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(seconds)) {
    return new Date(seconds * 1000).toLocaleString();
  }
  return String(value);
}

function stringifyMetadata(value: unknown) {
  if (value == null) return "No metadata";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function KVNamespacesView() {
  const [namespaces, setNamespaces] = useState<KVNamespace[]>([]);
  const [selectedNamespaceId, setSelectedNamespaceId] = useState<string | null>(null);
  const [keys, setKeys] = useState<KVKey[]>([]);
  const [prefix, setPrefix] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [entry, setEntry] = useState<KVEntry | null>(null);
  const [valueDraft, setValueDraft] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [ttlDraft, setTtlDraft] = useState("");
  const [clearTtlOnSave, setClearTtlOnSave] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "deleting">("idle");
  const [keyStatus, setKeyStatus] = useState<"idle" | "loading">("idle");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedNamespace = useMemo(
    () => namespaces.find((namespace) => namespace.id === selectedNamespaceId) ?? null,
    [namespaces, selectedNamespaceId]
  );

  const loadNamespaces = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const data = await fetchKVNamespaces();
      setNamespaces(data);
      setSelectedNamespaceId((current) => current ?? data[0]?.id ?? null);
      setStatus("idle");
    } catch (loadError) {
      setError(String(loadError));
      setStatus("idle");
    }
  }, []);

  const loadKeys = useCallback(
    async (mode: "reset" | "next" = "reset") => {
      if (!selectedNamespaceId) return;
      setKeyStatus("loading");
      setError(null);
      try {
        const result = await listKVKeys(
          selectedNamespaceId,
          prefix,
          mode === "next" ? cursor : undefined,
          100
        );
        setKeys((current) => (mode === "next" ? [...current, ...result.keys] : result.keys));
        setCursor(result.cursor);
        setKeyStatus("idle");
      } catch (loadError) {
        setError(String(loadError));
        setKeyStatus("idle");
      }
    },
    [cursor, prefix, selectedNamespaceId]
  );

  const loadEntry = useCallback(
    async (keyName: string) => {
      if (!selectedNamespaceId) return;
      setKeyStatus("loading");
      setError(null);
      setSelectedKey(keyName);
      try {
        const data = await getKVEntry(selectedNamespaceId, keyName);
        setEntry(data);
        setValueDraft(data.value);
        setKeyDraft(data.key);
        setTtlDraft("");
        setClearTtlOnSave(false);
        setKeyStatus("idle");
      } catch (loadError) {
        setError(String(loadError));
        setKeyStatus("idle");
      }
    },
    [selectedNamespaceId]
  );

  useEffect(() => {
    loadNamespaces();
  }, [loadNamespaces]);

  useEffect(() => {
    setKeys([]);
    setCursor(undefined);
    setSelectedKey(null);
    setEntry(null);
    if (selectedNamespaceId) {
      loadKeys("reset");
    }
  }, [selectedNamespaceId]);

  const saveEntry = async () => {
    if (!selectedNamespaceId || !keyDraft.trim()) return;
    const ttl = ttlDraft.trim() ? Number(ttlDraft) : undefined;
    if (ttl !== undefined && (!Number.isFinite(ttl) || ttl < 60)) {
      setError("TTL must be empty or at least 60 seconds.");
      return;
    }
    setStatus("saving");
    setError(null);
    setMessage(null);
    try {
      await putKVEntry(
        selectedNamespaceId,
        keyDraft.trim(),
        valueDraft,
        ttl,
        ttl === undefined && !clearTtlOnSave ? entry?.expiration : undefined,
        entry?.metadata
      );
      setMessage("KV entry saved.");
      await loadKeys("reset");
      await loadEntry(keyDraft.trim());
      setStatus("idle");
    } catch (saveError) {
      setError(String(saveError));
      setStatus("idle");
    }
  };

  const deleteEntry = async () => {
    if (!selectedNamespaceId || !selectedKey) return;
    const confirmed = window.confirm(`Delete KV key "${selectedKey}" from ${selectedNamespace?.title ?? "this namespace"}?`);
    if (!confirmed) return;
    setStatus("deleting");
    setError(null);
    setMessage(null);
    try {
      await deleteKVEntry(selectedNamespaceId, selectedKey);
      setMessage("KV entry deleted.");
      setSelectedKey(null);
      setEntry(null);
      setValueDraft("");
      setKeyDraft("");
      await loadKeys("reset");
      setStatus("idle");
    } catch (deleteError) {
      setError(String(deleteError));
      setStatus("idle");
    }
  };

  const formatJson = () => {
    try {
      const parsed = JSON.parse(valueDraft);
      setValueDraft(JSON.stringify(parsed, null, 2));
      setMessage("JSON formatted.");
      setError(null);
    } catch (jsonError) {
      setError(`Invalid JSON: ${String(jsonError)}`);
    }
  };

  return (
    <div className="flex h-full flex-col gap-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">KV Namespaces</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Inspect and edit remote Cloudflare Workers KV entries.
          </p>
        </div>
        <Button variant="outline" onClick={loadNamespaces} disabled={status === "loading"}>
          {status === "loading" ? <Loader2 size={15} className="mr-2 animate-spin" /> : <RefreshCw size={15} className="mr-2" />}
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700">
          {message}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[280px_360px_1fr]">
        <section className="min-h-0 overflow-hidden rounded-lg border border-border bg-background">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Namespaces</h2>
          </div>
          <div className="h-full overflow-y-auto p-2">
            {namespaces.length === 0 && status !== "loading" ? (
              <p className="p-3 text-sm text-muted-foreground">No KV namespaces found.</p>
            ) : (
              namespaces.map((namespace) => (
                <button
                  key={namespace.id}
                  onClick={() => setSelectedNamespaceId(namespace.id)}
                  className={cn(
                    "mb-1 w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted/50",
                    selectedNamespaceId === namespace.id && "bg-muted text-foreground"
                  )}
                >
                  <span className="block truncate font-medium">{namespace.title}</span>
                  <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">{namespace.id}</span>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="min-h-0 overflow-hidden rounded-lg border border-border bg-background">
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Keys</h2>
              {keyStatus === "loading" && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
            </div>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setCursor(undefined);
                loadKeys("reset");
              }}
            >
              <Input
                value={prefix}
                onChange={(event) => setPrefix(event.target.value)}
                placeholder="Prefix"
                className="h-8"
              />
              <Button className="h-8" variant="outline" type="submit">
                <Search size={14} />
              </Button>
            </form>
          </div>
          <div className="h-full overflow-y-auto p-2">
            {keys.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">No keys loaded.</p>
            ) : (
              keys.map((item) => (
                <button
                  key={item.name}
                  onClick={() => loadEntry(item.name)}
                  className={cn(
                    "mb-1 w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted/50",
                    selectedKey === item.name && "bg-muted text-foreground"
                  )}
                >
                  <span className="block truncate font-mono text-xs">{item.name}</span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {formatExpiration(item.expiration)}
                  </span>
                </button>
              ))
            )}
            {cursor && (
              <Button className="mt-2 w-full" variant="outline" onClick={() => loadKeys("next")}>
                Load more
              </Button>
            )}
          </div>
        </section>

        <section className="min-h-0 overflow-hidden rounded-lg border border-border bg-background">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">{entry ? entry.key : "Entry editor"}</h2>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {selectedNamespace?.title ?? "Select a namespace and key"}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedKey(null);
                setEntry(null);
                setKeyDraft(prefix);
                setValueDraft("");
                setTtlDraft("");
                setClearTtlOnSave(false);
              }}
            >
              <Plus size={14} className="mr-2" />
              New
            </Button>
          </div>

          <div className="grid h-full min-h-0 grid-rows-[auto_1fr_auto] gap-3 p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_160px]">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Key</label>
                <Input value={keyDraft} onChange={(event) => setKeyDraft(event.target.value)} placeholder="KV key" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">TTL seconds</label>
                <Input value={ttlDraft} onChange={(event) => setTtlDraft(event.target.value.replace(/[^\d]/g, ""))} placeholder="Optional" />
                {entry?.expiration && (
                  <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={clearTtlOnSave}
                      onChange={(event) => setClearTtlOnSave(event.target.checked)}
                      disabled={Boolean(ttlDraft.trim())}
                    />
                    Clear current TTL on save
                  </label>
                )}
              </div>
            </div>

            <div className="grid min-h-0 gap-3 xl:grid-cols-[1fr_260px]">
              <Textarea
                value={valueDraft}
                onChange={(event) => setValueDraft(event.target.value)}
                placeholder="KV value"
                className="min-h-[360px] resize-none font-mono text-xs"
              />
              <div className="flex min-h-0 flex-col gap-3">
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <div className="flex items-start gap-2">
                    <KeyRound size={14} className="mt-0.5 text-primary" />
                    <div>
                      <p className="text-xs font-medium">Expiration</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {formatExpiration(entry?.expiration)}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="min-h-0 rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-xs font-medium">Metadata</p>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
                    {stringifyMetadata(entry?.metadata)}
                  </pre>
                </div>
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={14} className="mt-0.5 text-amber-600" />
                    <p className="text-xs leading-5 text-muted-foreground">
                      Saving overwrites the remote value for this key. Deleting a key requires confirmation.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                <Button variant="outline" onClick={formatJson}>
                  <Braces size={14} className="mr-2" />
                  Format JSON
                </Button>
                <Button variant="outline" onClick={() => writeText(valueDraft, { label: "CF Studio" })}>
                  <Clipboard size={14} className="mr-2" />
                  Copy value
                </Button>
                <Button variant="outline" onClick={() => writeText(keyDraft || selectedKey || "", { label: "CF Studio" })} disabled={!keyDraft && !selectedKey}>
                  <Clipboard size={14} className="mr-2" />
                  Copy key
                </Button>
              </div>
              <div className="flex gap-2">
                <Button variant="destructive" onClick={deleteEntry} disabled={!selectedKey || status === "deleting"}>
                  {status === "deleting" ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Trash2 size={14} className="mr-2" />}
                  Delete
                </Button>
                <Button onClick={saveEntry} disabled={!selectedNamespaceId || !keyDraft.trim() || status === "saving"}>
                  {status === "saving" ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Save size={14} className="mr-2" />}
                  Save
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
