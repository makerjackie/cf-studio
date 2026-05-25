import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { ask, save } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  Box,
  CalendarDays,
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
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { useR2Buckets } from "@/hooks/useCloudflare";
import {
  cacheR2PublicThumbnail,
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
import {
  isCacheStale,
  r2ObjectListingCacheKey,
  useAppStore,
} from "@/store/useAppStore";

type CopyFormat = "url" | "markdown";
type ConflictPolicy = "overwrite" | "rename" | "skip";

interface PlannedUpload {
  file: File;
  key: string;
  contentType?: string;
}

interface PreparedUpload {
  file: File;
  originalKey: string;
  key: string;
  contentType?: string;
  skipped?: boolean;
}

const R2_PREFIX_PREFETCH_LIMIT = 4;

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

function normalizePrefix(value: string) {
  const trimmed = value.trim().replace(/^\/+/, "");
  if (!trimmed) return "";
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function datePrefix() {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}/`;
}

function folderPrefixForKey(key: string) {
  const index = key.lastIndexOf("/");
  return index >= 0 ? key.slice(0, index + 1) : "";
}

function splitFileName(name: string) {
  const index = name.lastIndexOf(".");
  if (index <= 0) return { base: name, ext: "" };
  return { base: name.slice(0, index), ext: name.slice(index) };
}

function nextAvailableKey(key: string, existing: Set<string>, reserved: Set<string>) {
  if (!existing.has(key) && !reserved.has(key)) return key;

  const prefix = folderPrefixForKey(key);
  const fileName = key.slice(prefix.length);
  const { base, ext } = splitFileName(fileName);

  for (let i = 1; i < 10_000; i += 1) {
    const candidate = `${prefix}${base}-${i}${ext}`;
    if (!existing.has(candidate) && !reserved.has(candidate)) {
      return candidate;
    }
  }

  return `${prefix}${base}-${Date.now()}${ext}`;
}

function objectLabel(key: string, prefix: string) {
  return key.replace(prefix, "") || key;
}

function markdownImage(url: string, key: string) {
  return `![${fileNameFromKey(key)}](${url})`;
}

function buildThumbnailCacheKey(accountId: string, bucketName: string, object: R2Object) {
  return ["thumb-v1", accountId || "default", bucketName, object.key, object.etag || object.uploaded].join("::");
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

function formatCacheTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function R2Thumbnail({
  publicUrl,
  cacheKey,
  alt,
}: {
  publicUrl: string;
  cacheKey: string;
  alt: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);

    cacheR2PublicThumbnail(publicUrl, cacheKey)
      .then((path) => {
        if (!cancelled) setSrc(convertFileSrc(path));
      })
      .catch(() => {
        if (!cancelled) setSrc(publicUrl);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, publicUrl]);

  if (!src) {
    return (
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border bg-muted/40">
        <ImageIcon size={15} className="text-muted-foreground" />
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className="h-9 w-9 shrink-0 rounded-md border border-border object-cover"
      loading="lazy"
    />
  );
}

export function R2BucketsView() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { state, refresh, isRefreshing: isRefreshingBuckets } = useR2Buckets();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const objectRequestIdRef = useRef(0);
  const prefetchInFlightRef = useRef<Set<string>>(new Set());
  const setR2ObjectListing = useAppStore((s) => s.setR2ObjectListing);
  const activeAccount = useAppStore((s) => s.activeAccount);
  const cloudflareAccountId = useAppStore((s) => s.cloudflareAccountId);
  const [selectedBucket, setSelectedBucket] = useState<R2Bucket | null>(null);
  const [prefix, setPrefix] = useState("");
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [objectFilter, setObjectFilter] = useState("");
  const [objectsState, setObjectsState] = useState<"idle" | "loading" | "error">("idle");
  const [objectsRefreshing, setObjectsRefreshing] = useState(false);
  const [objectsLastUpdated, setObjectsLastUpdated] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publicDomain, setPublicDomain] = useState<string | null>(null);
  const [domainsInfo, setDomainsInfo] = useState<BucketDomainsInfo | null>(null);
  const [domainState, setDomainState] = useState<"idle" | "loading" | "error">("idle");
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [previewObject, setPreviewObject] = useState<R2Object | null>(null);
  const [uploadPrefixInput, setUploadPrefixInput] = useState("");
  const [uploadNameOverride, setUploadNameOverride] = useState("");
  const [useDatePrefix, setUseDatePrefix] = useState(false);
  const [copyFormat, setCopyFormat] = useState<CopyFormat>("url");
  const [conflictPolicy, setConflictPolicy] = useState<ConflictPolicy>("rename");

  const buckets = state.status === "success" ? state.data : [];
  const currentDomainLabel = domainLabel(domainsInfo, publicDomain);
  const accountScope = activeAccount?.id || cloudflareAccountId || "default";
  const filteredFolders = (listing?.folders ?? []).filter((folder) =>
    objectFilter.trim() ? folder.toLowerCase().includes(objectFilter.trim().toLowerCase()) : true
  );
  const filteredFiles = (listing?.files ?? []).filter((object) =>
    objectFilter.trim() ? object.key.toLowerCase().includes(objectFilter.trim().toLowerCase()) : true
  );

  const loadObjects = useCallback(
    async (force = false) => {
      const bucketName = selectedBucket?.name;
      const requestId = ++objectRequestIdRef.current;

      if (!bucketName) {
        setListing(null);
        setObjectsState("idle");
        setObjectsRefreshing(false);
        setObjectsLastUpdated(null);
        setError(null);
        return;
      }

      const cacheKey = r2ObjectListingCacheKey(accountScope, bucketName, prefix);
      const cached = useAppStore.getState().r2ObjectListings[cacheKey];

      if (cached) {
        setListing(cached.data);
        setObjectsLastUpdated(cached.timestamp);
        setObjectsState("idle");
      } else {
        setListing(null);
        setObjectsLastUpdated(null);
      }

      setError(null);

      const shouldFetch = force || !cached || isCacheStale(cached.timestamp);
      if (!shouldFetch) {
        setObjectsRefreshing(false);
        return;
      }

      if (cached) {
        setObjectsRefreshing(true);
      } else {
        setObjectsState("loading");
        setObjectsRefreshing(false);
      }

      try {
        const nextListing = await listR2Objects(bucketName, prefix);
        if (objectRequestIdRef.current !== requestId) return;

        const updatedAt = Date.now();
        setR2ObjectListing(cacheKey, nextListing);
        setListing(nextListing);
        setObjectsLastUpdated(updatedAt);
        setObjectsState("idle");
      } catch (err) {
        if (objectRequestIdRef.current !== requestId) return;

        setError(String(err));
        if (cached) {
          setObjectsState("idle");
        } else {
          setObjectsState("error");
        }
      } finally {
        if (objectRequestIdRef.current === requestId) {
          setObjectsRefreshing(false);
        }
      }
    },
    [accountScope, prefix, selectedBucket?.name, setR2ObjectListing]
  );

  const reloadObjects = useCallback(async () => {
    await loadObjects(true);
  }, [loadObjects]);

  useEffect(() => {
    if (!selectedBucket && buckets.length > 0) {
      setSelectedBucket(buckets[0]);
    }
  }, [buckets, selectedBucket]);

  useEffect(() => {
    if (!selectedBucket) return;

    loadObjects(false);
  }, [loadObjects, selectedBucket]);

  useEffect(() => {
    return () => {
      objectRequestIdRef.current += 1;
    };
  }, []);

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

  const buildUploadPrefix = useCallback(() => {
    const basePrefix = normalizePrefix(uploadPrefixInput || prefix);
    return `${basePrefix}${useDatePrefix ? datePrefix() : ""}`;
  }, [prefix, uploadPrefixInput, useDatePrefix]);

  const planUploads = useCallback(
    (files: File[]): PlannedUpload[] => {
      const uploadPrefix = buildUploadPrefix();
      return files.map((file) => {
        const customName = files.length === 1 ? uploadNameOverride.trim().replace(/^\/+/, "") : "";
        const objectName = customName || file.name;
        return {
          file,
          key: `${uploadPrefix}${objectName}`,
          contentType: file.type || undefined,
        };
      });
    },
    [buildUploadPrefix, uploadNameOverride]
  );

  const fetchExistingKeys = useCallback(
    async (bucketName: string, keys: string[]) => {
      const existing = new Set<string>();
      const prefixes = Array.from(new Set(keys.map(folderPrefixForKey)));

      for (const targetPrefix of prefixes) {
        const remoteListing = await listR2Objects(bucketName, targetPrefix);
        setR2ObjectListing(
          r2ObjectListingCacheKey(accountScope, bucketName, targetPrefix),
          remoteListing
        );
        remoteListing.files.forEach((object) => existing.add(object.key));
      }

      return existing;
    },
    [accountScope, setR2ObjectListing]
  );

  const prepareUploads = useCallback(
    async (bucketName: string, plan: PlannedUpload[]): Promise<PreparedUpload[]> => {
      if (plan.length === 0) return [];

      const existing = await fetchExistingKeys(bucketName, plan.map((item) => item.key));
      const conflicts = plan.filter((item) => existing.has(item.key));

      if (conflicts.length > 0 && conflictPolicy === "overwrite") {
        const confirmed = await ask(
          t("r2.overwriteConfirmBody", { count: conflicts.length }),
          {
            title: t("r2.overwriteConfirmTitle"),
            kind: "warning",
            okLabel: t("r2.overwrite"),
            cancelLabel: t("common.cancel"),
          }
        );
        if (!confirmed) return [];
      }

      const reserved = new Set<string>();
      return plan
        .map<PreparedUpload>((item) => {
          const hasConflict = existing.has(item.key) || reserved.has(item.key);

          if (hasConflict && conflictPolicy === "skip") {
            return { ...item, originalKey: item.key, skipped: true };
          }

          const key = hasConflict && conflictPolicy === "rename"
            ? nextAvailableKey(item.key, existing, reserved)
            : nextAvailableKey(item.key, new Set(), reserved);

          reserved.add(key);
          return { ...item, originalKey: item.key, key };
        })
        .filter((item) => !item.skipped);
    },
    [conflictPolicy, fetchExistingKeys, t]
  );

  const prefetchR2Prefix = useCallback(
    async (targetPrefix: string) => {
      const bucketName = selectedBucket?.name;
      if (!bucketName) return;

      const cacheKey = r2ObjectListingCacheKey(accountScope, bucketName, targetPrefix);
      const cached = useAppStore.getState().r2ObjectListings[cacheKey];
      if (cached && !isCacheStale(cached.timestamp)) return;
      if (prefetchInFlightRef.current.has(cacheKey)) return;

      prefetchInFlightRef.current.add(cacheKey);
      try {
        const prefetched = await listR2Objects(bucketName, targetPrefix);
        setR2ObjectListing(cacheKey, prefetched);
      } catch {
        // Prefetch is an opportunistic optimization. Foreground navigation will
        // surface real errors if the user opens this prefix.
      } finally {
        prefetchInFlightRef.current.delete(cacheKey);
      }
    },
    [accountScope, selectedBucket?.name, setR2ObjectListing]
  );

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!selectedBucket || files.length === 0) return;
      setUploading(true);

      try {
        const plan = planUploads(files);
        const preparedUploads = await prepareUploads(selectedBucket.name, plan);
        if (preparedUploads.length === 0) {
          toast({ title: t("r2.uploadSkipped"), description: t("r2.uploadSkippedDesc") });
          return;
        }

        let copiedUrl: string | null = null;
        let copiedText: string | null = null;

        for (const item of preparedUploads) {
          const buffer = await item.file.arrayBuffer();
          const bytes = Array.from(new Uint8Array(buffer));
          await uploadR2ObjectBytes(selectedBucket.name, item.key, bytes, item.contentType);
          copiedUrl = buildPublicUrl(publicDomain, item.key);
          copiedText = copiedUrl && copyFormat === "markdown"
            ? markdownImage(copiedUrl, item.key)
            : copiedUrl;
        }

        await reloadObjects();
        const uploadPrefixes = Array.from(new Set(preparedUploads.map((item) => folderPrefixForKey(item.key))));
        uploadPrefixes.forEach((targetPrefix) => {
          if (targetPrefix !== prefix) {
            prefetchR2Prefix(targetPrefix);
          }
        });

        if (copiedText) {
          await navigator.clipboard.writeText(copiedText);
          toast({ title: t("r2.uploadCopied"), description: copiedText });
        } else {
          toast({ title: t("r2.uploaded"), description: t("r2.noPublicDomainCopy") });
        }
      } catch (err) {
        toast({ title: t("r2.uploadFailed"), description: String(err), variant: "destructive" });
      } finally {
        setUploading(false);
      }
    },
    [
      conflictPolicy,
      copyFormat,
      planUploads,
      prefetchR2Prefix,
      prefix,
      prepareUploads,
      publicDomain,
      reloadObjects,
      selectedBucket,
      t,
      toast,
    ]
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

  useEffect(() => {
    if (!selectedBucket || !listing || listing.folders.length === 0) return;

    const timer = window.setTimeout(() => {
      listing.folders
        .slice(0, R2_PREFIX_PREFETCH_LIMIT)
        .forEach((folder) => prefetchR2Prefix(folder));
    }, 350);

    return () => window.clearTimeout(timer);
  }, [listing, prefetchR2Prefix, selectedBucket]);

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
          <Button variant="ghost" size="icon" onClick={refresh} disabled={state.status === "loading" || isRefreshingBuckets}>
            <RefreshCw size={14} className={cn((state.status === "loading" || isRefreshingBuckets) && "animate-spin")} />
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

      <div className="grid gap-3 rounded-md border border-border bg-muted/20 p-3 xl:grid-cols-[1.2fr_1fr_auto_auto_auto]">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="r2-upload-prefix" className="text-xs text-muted-foreground">
            {t("r2.uploadPrefix")}
          </Label>
          <Input
            id="r2-upload-prefix"
            value={uploadPrefixInput}
            onChange={(event) => setUploadPrefixInput(event.target.value)}
            placeholder={prefix || t("r2.uploadPrefixPlaceholder")}
            className="h-9"
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="r2-upload-name" className="text-xs text-muted-foreground">
            {t("r2.uploadName")}
          </Label>
          <Input
            id="r2-upload-name"
            value={uploadNameOverride}
            onChange={(event) => setUploadNameOverride(event.target.value)}
            placeholder={t("r2.uploadNamePlaceholder")}
            className="h-9"
          />
        </div>
        <div className="flex items-end gap-2 pb-2">
          <Checkbox
            id="r2-date-prefix"
            checked={useDatePrefix}
            onCheckedChange={(checked) => setUseDatePrefix(checked === true)}
          />
          <Label htmlFor="r2-date-prefix" className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays size={13} />
            {t("r2.datePrefix")}
          </Label>
        </div>
        <div className="min-w-[150px] space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t("r2.conflictPolicy")}</Label>
          <Select value={conflictPolicy} onValueChange={(value) => setConflictPolicy(value as ConflictPolicy)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="rename">{t("r2.conflictRename")}</SelectItem>
              <SelectItem value="skip">{t("r2.conflictSkip")}</SelectItem>
              <SelectItem value="overwrite">{t("r2.conflictOverwrite")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[150px] space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t("r2.copyFormat")}</Label>
          <Select value={copyFormat} onValueChange={(value) => setCopyFormat(value as CopyFormat)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="url">{t("r2.copyUrlFormat")}</SelectItem>
              <SelectItem value="markdown">{t("r2.copyMarkdownFormat")}</SelectItem>
            </SelectContent>
          </Select>
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
              <div className="flex shrink-0 items-center gap-2">
                {objectsRefreshing && (
                  <Badge variant="secondary" className="h-6 gap-1.5 text-[10px]">
                    <Loader2 size={11} className="animate-spin" />
                    {t("r2.refreshingObjects")}
                  </Badge>
                )}
                {objectsLastUpdated && !objectsRefreshing && (
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {t("r2.cachedObjects").replace("{time}", formatCacheTime(objectsLastUpdated))}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={reloadObjects}
                  disabled={!selectedBucket || objectsRefreshing || objectsState === "loading"}
                  title={t("r2.refreshObjects")}
                >
                  <RefreshCw size={14} className={cn(objectsRefreshing && "animate-spin")} />
                </Button>
                <Button variant="outline" size="sm" onClick={goUp} disabled={!prefix}>
                  {t("r2.up")}
                </Button>
              </div>
            </div>

            <div className="border-t border-border/60 px-4 py-2">
              <div className="relative">
                <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={objectFilter}
                  onChange={(event) => setObjectFilter(event.target.value)}
                  placeholder={t("r2.filterObjects")}
                  className="h-8 pl-8 text-sm"
                />
              </div>
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
          {objectsState === "idle" && error && listing && (
            <p className="border-b border-border/60 px-4 py-2 text-xs text-destructive">
              {t("r2.refreshFailedUsingCache")}: {error}
            </p>
          )}
          {objectsState === "idle" && selectedBucket && listing && (
            <div className="divide-y divide-border">
              {filteredFolders.map((folder) => (
                <button
                  key={folder}
                  onClick={() => setPrefix(folder)}
                  onMouseEnter={() => prefetchR2Prefix(folder)}
                  onFocus={() => prefetchR2Prefix(folder)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted/50"
                >
                  <Folder size={15} className="text-primary" />
                  <span className="font-medium">{folder.replace(prefix, "")}</span>
                </button>
              ))}
              {filteredFiles.map((object) => {
                const publicUrl = buildPublicUrl(publicDomain, object.key);
                const isImage = isImageObject(object.key);

                return (
                  <div key={object.key} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/50">
                    <div className="flex min-w-0 items-center gap-3">
                      {isImage && publicUrl ? (
                        <R2Thumbnail
                          publicUrl={publicUrl}
                          cacheKey={buildThumbnailCacheKey(accountScope, selectedBucket.name, object)}
                          alt={objectLabel(object.key, prefix)}
                        />
                      ) : isImage ? (
                        <ImageIcon size={15} className="shrink-0 text-muted-foreground" />
                      ) : (
                        <FileIcon size={15} className="shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-medium">{objectLabel(object.key, prefix)}</p>
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
                      {publicUrl && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => copyText(markdownImage(publicUrl, object.key), t("r2.copyMarkdown"))}
                          title={t("r2.copyMarkdown")}
                        >
                          <Clipboard size={14} />
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
              {(listing.folders.length > 0 || listing.files.length > 0) && filteredFolders.length === 0 && filteredFiles.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">{t("r2.noFilterResults")}</p>
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
