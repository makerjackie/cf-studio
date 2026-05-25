import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import {
  Box,
  Clipboard,
  Copy,
  Download,
  Eye,
  File as FileIcon,
  Folder,
  Globe2,
  ImageIcon,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { useR2Buckets } from "@/hooks/useCloudflare";
import {
  deleteR2Object,
  downloadR2Object,
  getR2BucketDomain,
  getR2BucketDomainsList,
  listR2Objects,
  uploadR2ObjectBytes,
  type BucketDomainsInfo,
  type FolderListing,
  type R2Bucket,
  type R2Object,
} from "@/lib/r2";
import { cn, formatBytes } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

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

function encodeR2Key(key: string) {
  return key.split("/").map(encodeURIComponent).join("/");
}

function buildPublicUrl(domain: string | null, key: string) {
  if (!domain) return null;
  return `${domain.replace(/\/+$/, "")}/${encodeR2Key(key)}`;
}

function fileNameFromKey(key: string) {
  return key.split("/").filter(Boolean).pop() || "r2-object";
}

function extensionForMime(type: string) {
  const [, subtype = "png"] = type.split("/");
  if (subtype === "jpeg") return "jpg";
  if (subtype === "svg+xml") return "svg";
  return subtype.split("+")[0] || "png";
}

function isImageObject(key: string) {
  return /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(key);
}

function domainLabel(domainsInfo: BucketDomainsInfo | null, publicDomain: string | null) {
  if (!domainsInfo) return null;
  const custom = Array.isArray(domainsInfo.custom) ? domainsInfo.custom : [];
  const activeCustom = custom.find((item) => item?.enabled && item?.domain);
  if (activeCustom) return `Custom domain: ${activeCustom.domain}`;
  if (domainsInfo.managed?.enabled && domainsInfo.managed?.domain) {
    return `r2.dev: ${domainsInfo.managed.domain}`;
  }
  return publicDomain ? publicDomain : null;
}

export function R2BucketsView() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { state, refresh } = useR2Buckets();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<R2Bucket | null>(null);
  const [prefix, setPrefix] = useState("");
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [objectsState, setObjectsState] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [publicDomain, setPublicDomain] = useState<string | null>(null);
  const [domainsInfo, setDomainsInfo] = useState<BucketDomainsInfo | null>(null);
  const [domainState, setDomainState] = useState<"idle" | "loading" | "error">("idle");
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [previewObject, setPreviewObject] = useState<R2Object | null>(null);

  const buckets = state.status === "success" ? state.data : [];
  const currentDomainLabel = domainLabel(domainsInfo, publicDomain);

  const reloadObjects = useCallback(async () => {
    if (!selectedBucket) return;
    const nextListing = await listR2Objects(selectedBucket.name, prefix);
    setListing(nextListing);
  }, [selectedBucket, prefix]);

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

  useEffect(() => {
    if (!selectedBucket) return;

    let cancelled = false;
    setDomainState("loading");
    setPublicDomain(null);
    setDomainsInfo(null);

    Promise.all([
      getR2BucketDomain(selectedBucket.name),
      getR2BucketDomainsList(selectedBucket.name),
    ])
      .then(([domain, info]) => {
        if (cancelled) return;
        setPublicDomain(domain);
        setDomainsInfo(info);
        setDomainState("idle");
      })
      .catch((err) => {
        if (cancelled) return;
        setDomainState("error");
        setError(String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [selectedBucket]);

  const copyText = useCallback(
    async (value: string, title = t("common.copied")) => {
      await navigator.clipboard.writeText(value);
      toast({ title, description: value });
    },
    [t, toast]
  );

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!selectedBucket || files.length === 0) return;
      setUploading(true);

      try {
        let copiedUrl: string | null = null;
        for (const file of files) {
          const key = `${prefix}${file.name}`;
          const buffer = await file.arrayBuffer();
          const bytes = Array.from(new Uint8Array(buffer));
          await uploadR2ObjectBytes(selectedBucket.name, key, bytes, file.type || undefined);
          copiedUrl = buildPublicUrl(publicDomain, key);
        }

        await reloadObjects();

        if (copiedUrl) {
          await navigator.clipboard.writeText(copiedUrl);
          toast({ title: t("r2.uploadCopied"), description: copiedUrl });
        } else {
          toast({ title: t("r2.uploaded"), description: t("r2.noPublicDomainCopy") });
        }
      } catch (err) {
        toast({ title: t("r2.uploadFailed"), description: String(err), variant: "destructive" });
      } finally {
        setUploading(false);
      }
    },
    [prefix, publicDomain, reloadObjects, selectedBucket, t, toast]
  );

  const uploadClipboardImage = useCallback(async () => {
    try {
      if (!navigator.clipboard || !("read" in navigator.clipboard)) {
        toast({ title: t("r2.clipboardUnsupported"), variant: "destructive" });
        return;
      }

      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        const ext = extensionForMime(imageType);
        const file = new File([blob], `clipboard-${Date.now()}.${ext}`, { type: imageType });
        await uploadFiles([file]);
        return;
      }

      toast({ title: t("r2.noClipboardImage"), variant: "destructive" });
    } catch (err) {
      toast({ title: t("r2.clipboardFailed"), description: String(err), variant: "destructive" });
    }
  }, [t, toast, uploadFiles]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (!selectedBucket || uploading) return;
      const items = Array.from(event.clipboardData?.items ?? []);
      const imageItem = items.find((item) => item.type.startsWith("image/"));
      const file = imageItem?.getAsFile();
      if (!file) return;

      event.preventDefault();
      const ext = extensionForMime(file.type);
      uploadFiles([new File([file], `clipboard-${Date.now()}.${ext}`, { type: file.type })]);
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [selectedBucket, uploadFiles, uploading]);

  const goUp = () => {
    const trimmed = prefix.replace(/\/$/, "");
    const parent = trimmed.includes("/") ? `${trimmed.slice(0, trimmed.lastIndexOf("/") + 1)}` : "";
    setPrefix(parent);
  };

  const handleDeleteObject = async (key: string) => {
    if (!selectedBucket) return;
    await deleteR2Object(selectedBucket.name, key);
    await reloadObjects();
  };

  const handleDownloadObject = async (object: R2Object) => {
    if (!selectedBucket) return;
    const destinationPath = await save({ defaultPath: fileNameFromKey(object.key) });
    if (!destinationPath) return;

    try {
      await downloadR2Object(selectedBucket.name, object.key, destinationPath);
      toast({ title: t("r2.downloaded"), description: destinationPath });
    } catch (err) {
      toast({ title: t("r2.downloadFailed"), description: String(err), variant: "destructive" });
    }
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    await uploadFiles(files);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragActive(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">{t("r2.title")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("r2.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={!selectedBucket || uploading}
          >
            {uploading ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Upload size={14} className="mr-2" />}
            {t("r2.upload")}
          </Button>
          <Button variant="outline" size="sm" onClick={uploadClipboardImage} disabled={!selectedBucket || uploading}>
            <Clipboard size={14} className="mr-2" />
            {t("r2.pasteImage")}
          </Button>
          <Button variant="ghost" size="icon" onClick={refresh} disabled={state.status === "loading"}>
            <RefreshCw size={14} className={cn(state.status === "loading" && "animate-spin")} />
          </Button>
          <input
            ref={fileInputRef}
            className="hidden"
            type="file"
            multiple
            onChange={(event) => {
              uploadFiles(Array.from(event.target.files ?? []));
              event.currentTarget.value = "";
            }}
          />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr] overflow-hidden rounded-lg border border-border">
        <aside className="min-h-0 border-r border-border bg-muted/20 p-2">
          {state.status === "loading" && <p className="p-3 text-sm text-muted-foreground">{t("r2.loadingBuckets")}</p>}
          {state.status === "error" && <p className="p-3 text-sm text-destructive">{state.message}</p>}
          {state.status === "success" && buckets.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">{t("r2.noBuckets")}</p>
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

        <section
          className={cn("relative min-h-0 overflow-auto bg-background", dragActive && "bg-primary/5")}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {dragActive && (
            <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-lg border border-dashed border-primary bg-background/80 text-sm font-medium text-primary">
              {t("r2.dropToUpload")}
            </div>
          )}

          <div className="sticky top-0 z-10 border-b border-border bg-background/95">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{selectedBucket?.name ?? t("r2.selectBucket")}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">/{prefix}</p>
              </div>
              <Button variant="outline" size="sm" onClick={goUp} disabled={!prefix}>
                {t("r2.up")}
              </Button>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-2 text-xs">
              <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
                <Globe2 size={13} className="shrink-0" />
                {domainState === "loading" && <span>{t("r2.loadingDomain")}</span>}
                {domainState === "error" && <span className="text-destructive">{t("r2.domainError")}</span>}
                {domainState === "idle" && currentDomainLabel && (
                  <>
                    <Badge variant="secondary" className="h-5 text-[10px]">{t("r2.public")}</Badge>
                    <span className="truncate font-mono">{currentDomainLabel}</span>
                  </>
                )}
                {domainState === "idle" && !currentDomainLabel && (
                  <>
                    <Badge variant="outline" className="h-5 text-[10px]">{t("r2.private")}</Badge>
                    <span className="truncate">{t("r2.noPublicDomain")}</span>
                  </>
                )}
              </div>
              {publicDomain && (
                <Button variant="ghost" size="sm" className="h-7" onClick={() => copyText(publicDomain)}>
                  <Copy size={12} className="mr-1.5" />
                  {t("r2.copyDomain")}
                </Button>
              )}
            </div>
          </div>

          {objectsState === "loading" && <p className="p-4 text-sm text-muted-foreground">{t("r2.loadingObjects")}</p>}
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
              {listing.files.map((object) => {
                const publicUrl = buildPublicUrl(publicDomain, object.key);
                const isImage = isImageObject(object.key);

                return (
                  <div key={object.key} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/50">
                    <div className="flex min-w-0 items-center gap-3">
                      {isImage && publicUrl ? (
                        <img
                          src={publicUrl}
                          alt=""
                          className="h-9 w-9 shrink-0 rounded-md border border-border object-cover"
                          loading="lazy"
                        />
                      ) : isImage ? (
                        <ImageIcon size={15} className="shrink-0 text-muted-foreground" />
                      ) : (
                        <FileIcon size={15} className="shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-medium">{object.key.replace(prefix, "")}</p>
                        <p className="text-xs text-muted-foreground">{formatBytes(object.size)}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {isImage && publicUrl && (
                        <Button variant="ghost" size="icon" onClick={() => setPreviewObject(object)} title={t("r2.preview")}>
                          <Eye size={14} />
                        </Button>
                      )}
                      {publicUrl && (
                        <Button variant="ghost" size="icon" onClick={() => copyText(publicUrl)} title={t("r2.copyUrl")}>
                          <Copy size={14} />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => handleDownloadObject(object)} title={t("r2.download")}>
                        <Download size={14} />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDeleteObject(object.key)} title={t("r2.delete")}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                );
              })}
              {listing.folders.length === 0 && listing.files.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">{t("r2.noObjects")}</p>
              )}
            </div>
          )}
        </section>
      </div>

      <Dialog open={!!previewObject} onOpenChange={(open) => !open && setPreviewObject(null)}>
        <DialogContent className="max-w-4xl overflow-hidden p-0">
          <DialogTitle className="sr-only">{t("r2.preview")}</DialogTitle>
          {previewObject && buildPublicUrl(publicDomain, previewObject.key) && (
            <div className="flex max-h-[80vh] flex-col bg-background">
              <div className="border-b border-border px-4 py-3">
                <p className="truncate text-sm font-medium">{previewObject.key}</p>
                <p className="text-xs text-muted-foreground">{formatBytes(previewObject.size)}</p>
              </div>
              <div className="flex min-h-0 items-center justify-center overflow-auto bg-muted/30 p-4">
                <img
                  src={buildPublicUrl(publicDomain, previewObject.key) ?? undefined}
                  alt={previewObject.key}
                  className="max-h-[68vh] max-w-full rounded-md object-contain"
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
