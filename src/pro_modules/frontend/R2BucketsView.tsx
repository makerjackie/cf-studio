import { useEffect, useState } from "react";
import { Box, File, Folder, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useR2Buckets } from "@/hooks/useCloudflare";
import { deleteR2Object, listR2Objects, type FolderListing, type R2Bucket } from "@/lib/r2";
import { cn, formatBytes } from "@/lib/utils";

function BucketRow({
  bucket,
  active,
  onClick,
}: {
  bucket: R2Bucket;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
        active ? "bg-primary/10 text-primary" : "hover:bg-muted"
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Box size={14} className="shrink-0" />
        <span className="truncate font-medium">{bucket.name}</span>
      </span>
      {bucket.object_count != null && (
        <Badge variant="secondary" className="shrink-0 text-[10px]">
          {bucket.object_count}
        </Badge>
      )}
    </button>
  );
}

export function R2BucketsView() {
  const { state, refresh } = useR2Buckets();
  const [selectedBucket, setSelectedBucket] = useState<R2Bucket | null>(null);
  const [prefix, setPrefix] = useState("");
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [objectsState, setObjectsState] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const buckets = state.status === "success" ? state.data : [];

  useEffect(() => {
    if (!selectedBucket && buckets.length > 0) {
      setSelectedBucket(buckets[0]);
    }
  }, [buckets, selectedBucket]);

  useEffect(() => {
    if (!selectedBucket) return;

    let cancelled = false;
    setObjectsState("loading");
    setError(null);

    listR2Objects(selectedBucket.name, prefix)
      .then((nextListing) => {
        if (cancelled) return;
        setListing(nextListing);
        setObjectsState("idle");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
        setObjectsState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [selectedBucket, prefix]);

  const goUp = () => {
    const trimmed = prefix.replace(/\/$/, "");
    const parent = trimmed.includes("/") ? `${trimmed.slice(0, trimmed.lastIndexOf("/") + 1)}` : "";
    setPrefix(parent);
  };

  const handleDeleteObject = async (key: string) => {
    if (!selectedBucket) return;
    await deleteR2Object(selectedBucket.name, key);
    const nextListing = await listR2Objects(selectedBucket.name, prefix);
    setListing(nextListing);
  };

  return (
    <div className="flex h-full flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">R2 Buckets</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Public fallback view for listing buckets and objects in this fork.
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={refresh} disabled={state.status === "loading"}>
          <RefreshCw size={14} className={cn(state.status === "loading" && "animate-spin")} />
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr] overflow-hidden rounded-lg border border-border">
        <aside className="min-h-0 border-r border-border bg-muted/20 p-2">
          {state.status === "loading" && <p className="p-3 text-sm text-muted-foreground">Loading buckets...</p>}
          {state.status === "error" && <p className="p-3 text-sm text-destructive">{state.message}</p>}
          {state.status === "success" && buckets.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">No R2 buckets found.</p>
          )}
          <div className="space-y-1">
            {buckets.map((bucket) => (
              <BucketRow
                key={bucket.name}
                bucket={bucket}
                active={selectedBucket?.name === bucket.name}
                onClick={() => {
                  setSelectedBucket(bucket);
                  setPrefix("");
                }}
              />
            ))}
          </div>
        </aside>

        <section className="min-h-0 overflow-auto bg-background">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {selectedBucket?.name ?? "Select a bucket"}
              </p>
              <p className="truncate font-mono text-xs text-muted-foreground">/{prefix}</p>
            </div>
            <Button variant="outline" size="sm" onClick={goUp} disabled={!prefix}>
              Up
            </Button>
          </div>

          {objectsState === "loading" && <p className="p-4 text-sm text-muted-foreground">Loading objects...</p>}
          {objectsState === "error" && <p className="p-4 text-sm text-destructive">{error}</p>}
          {objectsState === "idle" && selectedBucket && listing && (
            <div className="divide-y divide-border">
              {listing.folders.map((folder) => (
                <button
                  key={folder}
                  onClick={() => setPrefix(folder)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted/50"
                >
                  <Folder size={15} className="text-primary" />
                  <span className="font-medium">{folder.replace(prefix, "")}</span>
                </button>
              ))}
              {listing.files.map((file) => (
                <div key={file.key} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/50">
                  <div className="flex min-w-0 items-center gap-3">
                    <File size={15} className="text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{file.key.replace(prefix, "")}</p>
                      <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => handleDeleteObject(file.key)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
              {listing.folders.length === 0 && listing.files.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">No objects in this prefix.</p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
