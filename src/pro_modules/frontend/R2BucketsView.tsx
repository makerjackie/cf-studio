import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { readImage, writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  Box,
  CalendarDays,
  CheckSquare2,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Copy,
  Download,
  Eye,
  File as FileIcon,
  FileText,
  Folder,
  Globe2,
  Grid2X2,
  ImageIcon,
  Info,
  List,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/use-toast";
import { useR2Buckets } from "@/hooks/useCloudflare";
import {
  cacheR2ObjectPreview,
  cacheR2PublicThumbnail,
  copyR2Object,
  deleteR2Object,
  downloadR2Object,
  getR2BucketDomain,
  getR2BucketDomainsList,
  listR2Objects,
  moveR2Object,
  uploadR2Object,
  uploadR2ObjectBytes,
  type BucketDomainsInfo,
  type FolderListing,
  type R2Bucket,
  type R2Object,
} from "@/lib/r2";
import { cn, formatBytes } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import {
  buildPreviewCacheKey,
  buildPublicUrl,
  buildThumbnailCacheKey,
  buildUploadPrefix as makeUploadPrefix,
  CopyFormat,
  extensionForMime,
  fileNameFromKey,
  fileNameFromPath,
  folderLabel,
  folderPrefixForKey,
  isImageObject,
  markdownImage,
  markdownImageLines,
  nextAvailableKey,
  objectLabel,
  objectTypeLabel,
  planUploadSources,
  prepareUploadPlan,
  publicUrlLines,
  R2SortField,
  selectedObjects,
  sortR2Objects,
  type ConflictPolicy,
  type PlannedUpload,
  type PreparedUpload,
  type UploadSource,
} from "@/lib/r2AssetUtils";
import {
  isCacheStale,
  r2BucketDomainCacheKey,
  R2_BUCKET_DOMAIN_CACHE_TTL_MS,
  r2ObjectListingCacheKey,
  useAppStore,
} from "@/store/useAppStore";

const R2_PREFIX_PREFETCH_LIMIT = 4;

type TransferStatus = "queued" | "running" | "done" | "failed";
type ObjectActionMode = "copy" | "move";

interface TransferItem {
  id: string;
  kind: "upload" | "download";
  key: string;
  label: string;
  status: TransferStatus;
  progress: number;
  error?: string;
}

interface ObjectActionState {
  mode: ObjectActionMode;
  object: R2Object;
}

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

function domainLabel(domainsInfo: BucketDomainsInfo | null, publicDomain: string | null) {
  if (!domainsInfo) return null;
  const custom = Array.isArray(domainsInfo.custom) ? domainsInfo.custom : [];
  const activeCustom = custom.find((item) => item?.enabled && item?.domain);
  if (activeCustom) return activeCustom.domain;
  if (domainsInfo.managed?.enabled && domainsInfo.managed?.domain) {
    return domainsInfo.managed.domain;
  }
  return publicDomain ? publicDomain : null;
}

function formatCacheTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatObjectTime(value: string) {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

function transferStatusKey(status: TransferStatus) {
  if (status === "queued") return "r2.transfer.queued";
  if (status === "running") return "r2.transfer.running";
  if (status === "done") return "r2.transfer.done";
  return "r2.transfer.failed";
}

async function clipboardImageToFile() {
  const image = await readImage();
  const size = await image.size();
  const rgba = await image.rgba();
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available.");
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), size.width, size.height), 0, 0);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not encode clipboard image.");
  return new File([blob], `clipboard-${Date.now()}.png`, { type: "image/png" });
}

function R2Thumbnail({
  accountScope,
  bucketName,
  object,
  publicUrl,
  alt,
  className,
}: {
  accountScope: string;
  bucketName: string;
  object: R2Object;
  publicUrl: string | null;
  alt: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);

    const cacheKey = buildThumbnailCacheKey(accountScope, bucketName, object);
    const request = publicUrl
      ? cacheR2PublicThumbnail(publicUrl, cacheKey)
      : cacheR2ObjectPreview(bucketName, object.key, buildPreviewCacheKey(accountScope, bucketName, object, 320), 320);

    request
      .then((path) => {
        if (!cancelled) setSrc(convertFileSrc(path));
      })
      .catch(() => {
        if (!cancelled) setSrc(publicUrl);
      });

    return () => {
      cancelled = true;
    };
  }, [accountScope, bucketName, object, publicUrl]);

  if (!src) {
    return (
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border bg-muted/40", className)}>
        <ImageIcon size={15} className="text-muted-foreground" />
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={cn("h-9 w-9 shrink-0 rounded-md border border-border object-cover", className)}
      loading="lazy"
      onError={() => setSrc(null)}
    />
  );
}

function R2PreviewImage({
  accountScope,
  bucketName,
  object,
  publicUrl,
}: {
  accountScope: string;
  bucketName: string;
  object: R2Object;
  publicUrl: string | null;
}) {
  const { t } = useI18n();
  const [src, setSrc] = useState<string | null>(publicUrl);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);

    if (publicUrl) {
      setSrc(publicUrl);
      return () => {
        cancelled = true;
      };
    }

    setSrc(null);
    cacheR2ObjectPreview(bucketName, object.key, buildPreviewCacheKey(accountScope, bucketName, object, 1600), 1600)
      .then((path) => {
        if (!cancelled) setSrc(convertFileSrc(path));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [accountScope, bucketName, object, publicUrl]);

  if (failed) {
    return <p className="text-sm text-destructive">{t("r2.previewFailed")}</p>;
  }

  if (!src) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={16} className="animate-spin" />
        {t("r2.loadingPreview")}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={object.key}
      className="max-h-[68vh] max-w-full rounded-md object-contain"
      onError={() => setFailed(true)}
    />
  );
}

export function R2BucketsView() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { state, refresh, isRefreshing: isRefreshingBuckets } = useR2Buckets();
  const objectRequestIdRef = useRef(0);
  const domainRequestIdRef = useRef(0);
  const prefetchInFlightRef = useRef<Set<string>>(new Set());
  const setR2ObjectListing = useAppStore((s) => s.setR2ObjectListing);
  const setR2BucketDomain = useAppStore((s) => s.setR2BucketDomain);
  const activeAccount = useAppStore((s) => s.activeAccount);
  const cloudflareAccountId = useAppStore((s) => s.cloudflareAccountId);
  const r2ViewMode = useAppStore((s) => s.r2ViewMode);
  const r2SortField = useAppStore((s) => s.r2SortField);
  const r2SortDirection = useAppStore((s) => s.r2SortDirection);
  const setR2ViewMode = useAppStore((s) => s.setR2ViewMode);
  const setR2Sort = useAppStore((s) => s.setR2Sort);
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
  const [domainRefreshing, setDomainRefreshing] = useState(false);
  const [domainLastUpdated, setDomainLastUpdated] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [previewObject, setPreviewObject] = useState<R2Object | null>(null);
  const [detailObject, setDetailObject] = useState<R2Object | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [objectAction, setObjectAction] = useState<ObjectActionState | null>(null);
  const [objectActionKey, setObjectActionKey] = useState("");
  const [objectActionRunning, setObjectActionRunning] = useState(false);
  const [uploadPrefixInput, setUploadPrefixInput] = useState("");
  const [uploadNameOverride, setUploadNameOverride] = useState("");
  const [useDatePrefix, setUseDatePrefix] = useState(false);
  const [copyFormat, setCopyFormat] = useState<CopyFormat>("url");
  const [conflictPolicy, setConflictPolicy] = useState<ConflictPolicy>("rename");
  const [cacheControl, setCacheControl] = useState("");

  const buckets = state.status === "success" ? state.data : [];
  const currentDomainLabel = domainLabel(domainsInfo, publicDomain);
  const accountScope = activeAccount?.id || cloudflareAccountId || "default";
  const filterText = objectFilter.trim().toLowerCase();
  const filteredFolders = (listing?.folders ?? []).filter((folder) =>
    filterText ? folder.toLowerCase().includes(filterText) : true
  );
  const filteredFiles = sortR2Objects(
    (listing?.files ?? []).filter((object) =>
      filterText ? object.key.toLowerCase().includes(filterText) : true
    ),
    r2SortField,
    r2SortDirection
  );
  const currentSelectedObjects = selectedObjects(listing?.files ?? [], selectedKeys);
  const previewableFiles = filteredFiles.filter((object) => isImageObject(object.key));
  const previewIndex = previewObject
    ? previewableFiles.findIndex((object) => object.key === previewObject.key)
    : -1;

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
    setSelectedKeys(new Set());
    setDetailObject(null);
    setPreviewObject(null);
    setObjectAction(null);
  }, [prefix, selectedBucket?.name]);

  useEffect(() => {
    return () => {
      objectRequestIdRef.current += 1;
      domainRequestIdRef.current += 1;
    };
  }, []);

  const loadDomain = useCallback(
    async (force = false) => {
      const bucketName = selectedBucket?.name;
      const requestId = ++domainRequestIdRef.current;

      if (!bucketName) {
        setPublicDomain(null);
        setDomainsInfo(null);
        setDomainState("idle");
        setDomainRefreshing(false);
        setDomainLastUpdated(null);
        return;
      }

      const cacheKey = r2BucketDomainCacheKey(accountScope, bucketName);
      const cached = useAppStore.getState().r2BucketDomains[cacheKey];

      if (cached) {
        setPublicDomain(cached.data.publicDomain);
        setDomainsInfo(cached.data.domainsInfo);
        setDomainLastUpdated(cached.timestamp);
        setDomainState("idle");
      } else {
        setPublicDomain(null);
        setDomainsInfo(null);
        setDomainLastUpdated(null);
      }

      const shouldFetch = force || !cached || Date.now() - cached.timestamp > R2_BUCKET_DOMAIN_CACHE_TTL_MS;
      if (!shouldFetch) {
        setDomainRefreshing(false);
        return;
      }

      if (cached) {
        setDomainRefreshing(true);
      } else {
        setDomainState("loading");
        setDomainRefreshing(false);
      }

      try {
        const [domain, info] = await Promise.all([
          getR2BucketDomain(bucketName),
          getR2BucketDomainsList(bucketName),
        ]);
        if (domainRequestIdRef.current !== requestId) return;

        setR2BucketDomain(cacheKey, domain, info);
        setPublicDomain(domain);
        setDomainsInfo(info);
        setDomainLastUpdated(Date.now());
        setDomainState("idle");
      } catch (err) {
        if (domainRequestIdRef.current !== requestId) return;
        setDomainState(cached ? "idle" : "error");
        setError(String(err));
      } finally {
        if (domainRequestIdRef.current === requestId) {
          setDomainRefreshing(false);
        }
      }
    },
    [accountScope, selectedBucket?.name, setR2BucketDomain]
  );

  useEffect(() => {
    loadDomain(false);
  }, [loadDomain]);

  const tryCopyText = useCallback(async (value: string) => {
    try {
      await writeText(value, { label: "CF Studio" });
      return true;
    } catch (err) {
      console.warn("[CF Studio] Clipboard write failed:", err);
      return false;
    }
  }, []);

  const copyText = useCallback(
    async (value: string, title = t("common.copied")) => {
      const copied = await tryCopyText(value);
      toast({
        title: copied ? title : t("r2.copyFailed"),
        description: copied ? value : t("r2.copyFailedDesc"),
        variant: copied ? "default" : "destructive",
      });
    },
    [t, toast, tryCopyText]
  );

  const addTransfer = useCallback((item: Omit<TransferItem, "id" | "status" | "progress">) => {
    const id = crypto.randomUUID();
    setTransfers((current) => [
      {
        id,
        status: "queued",
        progress: 0,
        ...item,
      },
      ...current,
    ]);
    return id;
  }, []);

  const updateTransfer = useCallback((id: string, patch: Partial<TransferItem>) => {
    setTransfers((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const buildUploadPrefix = useCallback(() => {
    return makeUploadPrefix(prefix, uploadPrefixInput, useDatePrefix);
  }, [prefix, uploadPrefixInput, useDatePrefix]);

  const planUploads = useCallback(
    (sources: UploadSource[]): PlannedUpload[] => {
      return planUploadSources(sources, buildUploadPrefix(), uploadNameOverride);
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

      return prepareUploadPlan(plan, existing, conflictPolicy);
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

  const uploadSources = useCallback(
    async (sources: UploadSource[]) => {
      if (!selectedBucket || sources.length === 0) return;
      setUploading(true);

      try {
        const plan = planUploads(sources);
        const preparedUploads = await prepareUploads(selectedBucket.name, plan);
        if (preparedUploads.length === 0) {
          toast({ title: t("r2.uploadSkipped"), description: t("r2.uploadSkippedDesc") });
          return;
        }

        let copiedUrl: string | null = null;
        let copiedText: string | null = null;

        for (const item of preparedUploads) {
          const transferId = addTransfer({
            kind: "upload",
            key: item.key,
            label: fileNameFromKey(item.key),
          });

          try {
            updateTransfer(transferId, { status: "running", progress: 20 });
            if (item.source.localPath) {
              await uploadR2Object(selectedBucket.name, item.key, item.source.localPath, crypto.randomUUID(), cacheControl.trim() || undefined);
            } else if (item.source.file) {
              const buffer = await item.source.file.arrayBuffer();
              const bytes = Array.from(new Uint8Array(buffer));
              updateTransfer(transferId, { progress: 45 });
              await uploadR2ObjectBytes(selectedBucket.name, item.key, bytes, item.contentType, cacheControl.trim() || undefined);
            } else {
              updateTransfer(transferId, { status: "failed", error: "Missing upload source." });
              continue;
            }
            updateTransfer(transferId, { status: "done", progress: 100 });
          } catch (err) {
            updateTransfer(transferId, { status: "failed", progress: 100, error: String(err) });
            throw err;
          }

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
          const copied = await tryCopyText(copiedText);
          toast({
            title: copied ? t("r2.uploadCopied") : t("r2.uploadedCopyFailed"),
            description: copied ? copiedText : t("r2.copyFailedDesc"),
            variant: copied ? "default" : "destructive",
          });
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
      cacheControl,
      planUploads,
      prefetchR2Prefix,
      prefix,
      prepareUploads,
      publicDomain,
      reloadObjects,
      selectedBucket,
      t,
      toast,
      tryCopyText,
      addTransfer,
      updateTransfer,
    ]
  );

  const uploadFiles = useCallback(
    async (files: File[]) => {
      await uploadSources(
        files.map((file) => ({
          name: file.name,
          file,
          contentType: file.type || undefined,
        }))
      );
    },
    [uploadSources]
  );

  const uploadLocalPaths = useCallback(
    async (paths: string[]) => {
      await uploadSources(
        paths.map((path) => ({
          name: fileNameFromPath(path),
          localPath: path,
        }))
      );
    },
    [uploadSources]
  );

  const openUploadDialog = useCallback(async () => {
    const selected = await open({
      multiple: true,
      directory: false,
    });
    const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
    if (paths.length > 0) {
      await uploadLocalPaths(paths);
    }
  }, [uploadLocalPaths]);

  const uploadClipboardImage = useCallback(async () => {
    try {
      const file = await clipboardImageToFile();
      await uploadFiles([file]);
    } catch (err) {
      console.warn("[CF Studio] Clipboard image read failed:", err);
      await openUploadDialog();
    }
  }, [openUploadDialog, uploadFiles]);

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

  const openObjectAction = useCallback(
    (mode: ObjectActionMode, object: R2Object) => {
      const existingKeys = new Set((listing?.files ?? []).map((item) => item.key));
      setObjectAction({ mode, object });
      setObjectActionKey(
        mode === "copy"
          ? nextAvailableKey(object.key, existingKeys, new Set())
          : object.key
      );
    },
    [listing?.files]
  );

  const submitObjectAction = useCallback(async () => {
    if (!selectedBucket || !objectAction) return;

    const destinationKey = objectActionKey.trim().replace(/^\/+/, "");
    if (!destinationKey) {
      toast({ title: t("r2.destinationRequired"), variant: "destructive" });
      return;
    }
    if (objectAction.mode === "move" && destinationKey === objectAction.object.key) {
      toast({ title: t("r2.destinationSame"), variant: "destructive" });
      return;
    }

    setObjectActionRunning(true);
    try {
      if (objectAction.mode === "copy") {
        await copyR2Object(selectedBucket.name, objectAction.object.key, destinationKey);
      } else {
        await moveR2Object(selectedBucket.name, objectAction.object.key, destinationKey);
        setDetailObject(null);
        setPreviewObject((current) => (current?.key === objectAction.object.key ? null : current));
        setSelectedKeys((current) => {
          const next = new Set(current);
          next.delete(objectAction.object.key);
          return next;
        });
      }

      await reloadObjects();
      const destinationPrefix = folderPrefixForKey(destinationKey);
      if (destinationPrefix !== prefix) {
        prefetchR2Prefix(destinationPrefix);
      }
      toast({
        title: objectAction.mode === "copy" ? t("r2.objectCopied") : t("r2.objectMoved"),
        description: destinationKey,
      });
      setObjectAction(null);
    } catch (err) {
      toast({ title: t("r2.objectActionFailed"), description: String(err), variant: "destructive" });
    } finally {
      setObjectActionRunning(false);
    }
  }, [
    objectAction,
    objectActionKey,
    prefix,
    prefetchR2Prefix,
    reloadObjects,
    selectedBucket,
    t,
    toast,
  ]);

  const downloadObjectsToDirectory = useCallback(
    async (objects: R2Object[]) => {
      if (!selectedBucket || objects.length === 0) return;
      const selected = await open({ directory: true, multiple: false });
      const directory = Array.isArray(selected) ? selected[0] : selected;
      if (!directory) return;

      for (const object of objects) {
        const transferId = addTransfer({
          kind: "download",
          key: object.key,
          label: fileNameFromKey(object.key),
        });
        const destinationPath = `${directory.replace(/\/+$/, "")}/${fileNameFromKey(object.key)}`;

        try {
          updateTransfer(transferId, { status: "running", progress: 20 });
          await downloadR2Object(selectedBucket.name, object.key, destinationPath);
          updateTransfer(transferId, { status: "done", progress: 100 });
        } catch (err) {
          updateTransfer(transferId, { status: "failed", progress: 100, error: String(err) });
        }
      }
    },
    [addTransfer, selectedBucket, updateTransfer]
  );

  const toggleObjectSelection = useCallback((key: string) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedKeys((current) => {
      if (filteredFiles.length > 0 && filteredFiles.every((object) => current.has(object.key))) {
        const next = new Set(current);
        filteredFiles.forEach((object) => next.delete(object.key));
        return next;
      }
      const next = new Set(current);
      filteredFiles.forEach((object) => next.add(object.key));
      return next;
    });
  }, [filteredFiles]);

  const deleteSelectedObjects = useCallback(async () => {
    if (!selectedBucket || currentSelectedObjects.length === 0) return;
    const confirmed = await ask(t("r2.deleteSelectedConfirm", { count: currentSelectedObjects.length }), {
      title: t("r2.deleteSelected"),
      kind: "warning",
      okLabel: t("r2.delete"),
      cancelLabel: t("common.cancel"),
    });
    if (!confirmed) return;

    for (const object of currentSelectedObjects) {
      await deleteR2Object(selectedBucket.name, object.key);
    }
    setSelectedKeys(new Set());
    await reloadObjects();
  }, [currentSelectedObjects, reloadObjects, selectedBucket, t]);

  const copySelectedUrls = useCallback(async () => {
    const value = publicUrlLines(currentSelectedObjects, publicDomain);
    if (value) {
      await copyText(value, t("r2.copyUrls"));
    }
  }, [copyText, currentSelectedObjects, publicDomain, t]);

  const copySelectedMarkdown = useCallback(async () => {
    const value = markdownImageLines(currentSelectedObjects, publicDomain);
    if (value) {
      await copyText(value, t("r2.copyMarkdown"));
    }
  }, [copyText, currentSelectedObjects, publicDomain, t]);

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
            onClick={openUploadDialog}
            disabled={!selectedBucket || uploading}
          >
            {uploading ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Upload size={14} className="mr-2" />}
            {t("r2.upload")}
          </Button>
          <Button variant="outline" size="sm" onClick={uploadClipboardImage} disabled={!selectedBucket || uploading}>
            <Clipboard size={14} className="mr-2" />
            {t("r2.pasteOrUpload")}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)} disabled={!selectedBucket} title={t("r2.uploadSettings")}>
            <SlidersHorizontal size={14} />
          </Button>
          <Button variant="ghost" size="icon" onClick={refresh} disabled={state.status === "loading" || isRefreshingBuckets}>
            <RefreshCw size={14} className={cn((state.status === "loading" || isRefreshingBuckets) && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className={cn(
        "grid min-h-0 flex-1 overflow-hidden rounded-lg border border-border",
        detailObject ? "grid-cols-[260px_1fr_320px]" : "grid-cols-[260px_1fr]"
      )}>
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
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[220px] flex-1">
                  <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={objectFilter}
                    onChange={(event) => setObjectFilter(event.target.value)}
                    placeholder={t("r2.filterObjects")}
                    className="h-8 pl-8 text-sm"
                  />
                </div>
                <div className="flex rounded-md border border-border p-0.5">
                  <Button
                    variant={r2ViewMode === "list" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => setR2ViewMode("list")}
                    title={t("r2.listView")}
                  >
                    <List size={13} />
                  </Button>
                  <Button
                    variant={r2ViewMode === "grid" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => setR2ViewMode("grid")}
                    title={t("r2.gridView")}
                  >
                    <Grid2X2 size={13} />
                  </Button>
                </div>
                <Select value={r2SortField} onValueChange={(value) => setR2Sort(value as R2SortField, r2SortDirection)}>
                  <SelectTrigger className="h-8 w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name">{t("r2.sortName")}</SelectItem>
                    <SelectItem value="size">{t("r2.sortSize")}</SelectItem>
                    <SelectItem value="updated">{t("r2.sortUpdated")}</SelectItem>
                    <SelectItem value="type">{t("r2.sortType")}</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  onClick={() => setR2Sort(r2SortField, r2SortDirection === "asc" ? "desc" : "asc")}
                >
                  {r2SortDirection === "asc" ? "A-Z" : "Z-A"}
                </Button>
                {filteredFiles.length > 0 && (
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={selectAllVisible}>
                    {filteredFiles.every((object) => selectedKeys.has(object.key)) ? <CheckSquare2 size={13} /> : <Square size={13} />}
                    {t("r2.selectVisible")}
                  </Button>
                )}
              </div>
            </div>

            {selectedKeys.size > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-muted/25 px-4 py-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("r2.selectedCount", { count: currentSelectedObjects.length })}
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button variant="outline" size="sm" className="h-7" onClick={copySelectedUrls} disabled={!publicDomain}>
                    <Copy size={12} className="mr-1.5" />
                    {t("r2.copyUrls")}
                  </Button>
                  <Button variant="outline" size="sm" className="h-7" onClick={copySelectedMarkdown} disabled={!publicDomain}>
                    <Clipboard size={12} className="mr-1.5" />
                    {t("r2.copyMarkdown")}
                  </Button>
                  <Button variant="outline" size="sm" className="h-7" onClick={() => downloadObjectsToDirectory(currentSelectedObjects)}>
                    <Download size={12} className="mr-1.5" />
                    {t("r2.downloadSelected")}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-destructive" onClick={deleteSelectedObjects}>
                    <Trash2 size={12} className="mr-1.5" />
                    {t("r2.deleteSelected")}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedKeys(new Set())}>
                    <X size={12} />
                  </Button>
                </div>
              </div>
            )}

            <div className="group flex items-center justify-between gap-3 border-t border-border/60 px-4 py-2 text-xs">
              <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
                <Globe2 size={13} className="shrink-0" />
                {domainState === "loading" && <span>{t("r2.loadingDomain")}</span>}
                {domainState === "error" && <span className="text-destructive">{t("r2.domainError")}</span>}
                {domainState === "idle" && currentDomainLabel && (
                  <>
                    <Badge variant="secondary" className="h-5 text-[10px]">{t("r2.public")}</Badge>
                    <span className="truncate font-mono">{currentDomainLabel}</span>
                    {domainLastUpdated && (
                      <span className="hidden shrink-0 text-[10px] text-muted-foreground/70 sm:inline">
                        {t("r2.cachedObjects").replace("{time}", formatCacheTime(domainLastUpdated))}
                      </span>
                    )}
                  </>
                )}
                {domainState === "idle" && !currentDomainLabel && (
                  <>
                    <Badge variant="outline" className="h-5 text-[10px]">{t("r2.private")}</Badge>
                    <span className="truncate">{t("r2.noPublicDomain")}</span>
                    {domainLastUpdated && (
                      <span className="hidden shrink-0 text-[10px] text-muted-foreground/70 sm:inline">
                        {t("r2.cachedObjects").replace("{time}", formatCacheTime(domainLastUpdated))}
                      </span>
                    )}
                  </>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                        onClick={() => loadDomain(true)}
                        disabled={!selectedBucket || domainRefreshing || domainState === "loading"}
                      >
                        <RefreshCw size={12} className={cn(domainRefreshing && "animate-spin")} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("r2.refreshDomain")}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {publicDomain && (
                  <Button variant="ghost" size="sm" className="h-7" onClick={() => copyText(publicDomain)}>
                    <Copy size={12} className="mr-1.5" />
                    {t("r2.copyDomain")}
                  </Button>
                )}
              </div>
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
            <div className={cn(r2ViewMode === "list" ? "divide-y divide-border" : "p-4")}>
              {r2ViewMode === "list" && filteredFolders.map((folder) => (
                <button
                  key={folder}
                  onClick={() => setPrefix(folder)}
                  onMouseEnter={() => prefetchR2Prefix(folder)}
                  onFocus={() => prefetchR2Prefix(folder)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted/50"
                >
                  <Folder size={15} className="text-primary" />
                  <span className="font-medium">{folderLabel(folder, prefix)}</span>
                </button>
              ))}
              {r2ViewMode === "grid" && (
                <div className="mb-4 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                  {filteredFolders.map((folder) => (
                    <button
                      key={folder}
                      onClick={() => setPrefix(folder)}
                      onMouseEnter={() => prefetchR2Prefix(folder)}
                      onFocus={() => prefetchR2Prefix(folder)}
                      className="flex aspect-[4/3] flex-col justify-between rounded-md border border-border bg-muted/20 p-3 text-left text-sm hover:bg-muted/50"
                    >
                      <Folder size={24} className="text-primary" />
                      <span className="line-clamp-2 font-medium">{folderLabel(folder, prefix)}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className={cn(r2ViewMode === "grid" && "grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3")}>
                {filteredFiles.map((object) => {
                  const publicUrl = buildPublicUrl(publicDomain, object.key);
                  const isImage = isImageObject(object.key);
                  const checked = selectedKeys.has(object.key);

                  if (r2ViewMode === "grid") {
                    return (
                      <div
                        key={object.key}
                        className={cn(
                          "group relative overflow-hidden rounded-md border border-border bg-background hover:border-primary/40",
                          detailObject?.key === object.key && "border-primary"
                        )}
                      >
                        <button
                          type="button"
                          className="absolute left-2 top-2 z-10 rounded bg-background/90 p-1 shadow-sm"
                          onClick={() => toggleObjectSelection(object.key)}
                          title={checked ? t("r2.unselectObject") : t("r2.selectObject")}
                        >
                          {checked ? <CheckSquare2 size={14} className="text-primary" /> : <Square size={14} />}
                        </button>
                        <button
                          type="button"
                          className="block w-full text-left"
                          onClick={() => {
                            setDetailObject(object);
                            if (isImage) setPreviewObject(object);
                          }}
                        >
                          <div className="grid aspect-square place-items-center bg-muted/30">
                            {isImage ? (
                              <R2Thumbnail
                                accountScope={accountScope}
                                bucketName={selectedBucket.name}
                                object={object}
                                publicUrl={publicUrl}
                                alt={objectLabel(object.key, prefix)}
                                className="h-full w-full rounded-none border-0"
                              />
                            ) : (
                              <FileIcon size={30} className="text-muted-foreground" />
                            )}
                          </div>
                          <div className="space-y-1 p-2">
                            <p className="line-clamp-2 text-xs font-medium">{objectLabel(object.key, prefix)}</p>
                            <p className="text-[11px] text-muted-foreground">{formatBytes(object.size)}</p>
                          </div>
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={object.key}
                      className={cn(
                        "flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/50",
                        detailObject?.key === object.key && "bg-primary/5"
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <button
                          type="button"
                          onClick={() => toggleObjectSelection(object.key)}
                          title={checked ? t("r2.unselectObject") : t("r2.selectObject")}
                        >
                          {checked ? <CheckSquare2 size={15} className="text-primary" /> : <Square size={15} className="text-muted-foreground" />}
                        </button>
                        {isImage ? (
                          <R2Thumbnail
                            accountScope={accountScope}
                            bucketName={selectedBucket.name}
                            object={object}
                            publicUrl={publicUrl}
                            alt={objectLabel(object.key, prefix)}
                          />
                        ) : (
                          <FileIcon size={15} className="shrink-0 text-muted-foreground" />
                        )}
                        <button
                          type="button"
                          className="min-w-0 text-left"
                          onClick={() => setDetailObject(object)}
                        >
                          <p className="truncate font-medium">{objectLabel(object.key, prefix)}</p>
                          <p className="text-xs text-muted-foreground">{formatBytes(object.size)} · {objectTypeLabel(object.key)}</p>
                        </button>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {isImage && (
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
                        <Button variant="ghost" size="icon" onClick={() => setDetailObject(object)} title={t("r2.details")}>
                          <Info size={14} />
                        </Button>
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
              </div>
              {listing.folders.length === 0 && listing.files.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">{t("r2.noObjects")}</p>
              )}
              {(listing.folders.length > 0 || listing.files.length > 0) && filteredFolders.length === 0 && filteredFiles.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">{t("r2.noFilterResults")}</p>
              )}
            </div>
          )}
        </section>
        {detailObject && selectedBucket && (
          <aside className="min-h-0 overflow-auto border-l border-border bg-muted/10">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{t("r2.details")}</p>
                <p className="truncate text-xs text-muted-foreground">{fileNameFromKey(detailObject.key)}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDetailObject(null)}>
                <X size={14} />
              </Button>
            </div>
            <div className="space-y-4 p-4 text-sm">
              {isImageObject(detailObject.key) && (
                <div className="overflow-hidden rounded-md border border-border bg-background">
                  <div className="grid aspect-video place-items-center bg-muted/30">
                    <R2Thumbnail
                      accountScope={accountScope}
                      bucketName={selectedBucket.name}
                      object={detailObject}
                      publicUrl={buildPublicUrl(publicDomain, detailObject.key)}
                      alt={detailObject.key}
                      className="h-full w-full rounded-none border-0"
                    />
                  </div>
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("r2.objectKey")}</Label>
                <p className="break-all font-mono text-xs">{detailObject.key}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{t("r2.size")}</Label>
                  <p>{formatBytes(detailObject.size)}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{t("r2.type")}</Label>
                  <p>{objectTypeLabel(detailObject.key)}</p>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("r2.updated")}</Label>
                <p>{formatObjectTime(detailObject.uploaded)}</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">ETag</Label>
                <p className="break-all font-mono text-xs">{detailObject.etag || t("common.notAvailable")}</p>
              </div>
              {buildPublicUrl(publicDomain, detailObject.key) ? (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">{t("r2.publicUrl")}</Label>
                  <p className="break-all font-mono text-xs">{buildPublicUrl(publicDomain, detailObject.key)}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => copyText(buildPublicUrl(publicDomain, detailObject.key) || "")}>
                      <Copy size={13} className="mr-1.5" />
                      {t("r2.copyUrl")}
                    </Button>
                    {isImageObject(detailObject.key) && (
                      <Button size="sm" variant="outline" onClick={() => copyText(markdownImage(buildPublicUrl(publicDomain, detailObject.key) || "", detailObject.key), t("r2.copyMarkdown"))}>
                        <FileText size={13} className="mr-1.5" />
                        {t("r2.copyMarkdown")}
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="rounded-md border border-border bg-background p-3 text-xs text-muted-foreground">
                  {t("r2.privatePreviewHint")}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {isImageObject(detailObject.key) && (
                  <Button size="sm" onClick={() => setPreviewObject(detailObject)}>
                    <Eye size={13} className="mr-1.5" />
                    {t("r2.preview")}
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => handleDownloadObject(detailObject)}>
                  <Download size={13} className="mr-1.5" />
                  {t("r2.download")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => openObjectAction("copy", detailObject)}>
                  <Copy size={13} className="mr-1.5" />
                  {t("r2.copyObject")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => openObjectAction("move", detailObject)}>
                  <Pencil size={13} className="mr-1.5" />
                  {t("r2.moveObject")}
                </Button>
              </div>
            </div>
          </aside>
        )}
      </div>

      {transfers.length > 0 && (
        <div className="rounded-lg border border-border bg-background">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Upload size={14} />
              {t("r2.transfers")}
            </div>
            <Button variant="ghost" size="sm" className="h-7" onClick={() => setTransfers((items) => items.filter((item) => item.status === "running" || item.status === "queued"))}>
              {t("r2.clearCompleted")}
            </Button>
          </div>
          <div className="max-h-36 overflow-auto divide-y divide-border">
            {transfers.map((item) => (
              <div key={item.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2 text-xs">
                {item.kind === "upload" ? <Upload size={13} className="text-muted-foreground" /> : <Download size={13} className="text-muted-foreground" />}
                <div className="min-w-0">
                  <p className="truncate font-medium">{item.label}</p>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full bg-primary", item.status === "failed" && "bg-destructive")}
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                  {item.error && <p className="mt-1 truncate text-destructive">{item.error}</p>}
                </div>
                <Badge variant={item.status === "failed" ? "destructive" : "secondary"} className="text-[10px]">
                  {t(transferStatusKey(item.status))}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("r2.uploadSettings")}</DialogTitle>
            <DialogDescription>{t("r2.uploadSettingsDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
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
            <div className="space-y-1.5">
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
            <div className="space-y-1.5 sm:col-span-2">
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
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="r2-cache-control" className="text-xs text-muted-foreground">
                {t("r2.cacheControl")}
              </Label>
              <Input
                id="r2-cache-control"
                value={cacheControl}
                onChange={(event) => setCacheControl(event.target.value)}
                placeholder="public, max-age=31536000, immutable"
                className="h-9 font-mono text-xs"
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!objectAction} onOpenChange={(open) => !open && !objectActionRunning && setObjectAction(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {objectAction?.mode === "copy" ? t("r2.copyObject") : t("r2.moveObject")}
            </DialogTitle>
            <DialogDescription>{t("r2.objectActionDesc")}</DialogDescription>
          </DialogHeader>
          {objectAction && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t("r2.objectKey")}</Label>
                <p className="break-all rounded-md border border-border bg-muted/30 p-2 font-mono text-xs">
                  {objectAction.object.key}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="r2-destination-key" className="text-xs text-muted-foreground">
                  {t("r2.destinationKey")}
                </Label>
                <Input
                  id="r2-destination-key"
                  value={objectActionKey}
                  onChange={(event) => setObjectActionKey(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitObjectAction();
                    }
                  }}
                  className="font-mono text-xs"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setObjectAction(null)} disabled={objectActionRunning}>
                  {t("common.cancel")}
                </Button>
                <Button onClick={submitObjectAction} disabled={objectActionRunning}>
                  {objectActionRunning && <Loader2 size={14} className="mr-2 animate-spin" />}
                  {objectAction.mode === "copy" ? t("r2.copyObject") : t("r2.moveObject")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewObject} onOpenChange={(open) => !open && setPreviewObject(null)}>
        <DialogContent className="max-w-4xl overflow-hidden p-0">
          <DialogTitle className="sr-only">{t("r2.preview")}</DialogTitle>
          {previewObject && selectedBucket && (
            <div className="flex max-h-[80vh] flex-col bg-background">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{previewObject.key}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(previewObject.size)} · {formatObjectTime(previewObject.uploaded)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={previewIndex <= 0}
                    onClick={() => setPreviewObject(previewableFiles[previewIndex - 1])}
                  >
                    <ChevronLeft size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={previewIndex < 0 || previewIndex >= previewableFiles.length - 1}
                    onClick={() => setPreviewObject(previewableFiles[previewIndex + 1])}
                  >
                    <ChevronRight size={16} />
                  </Button>
                  {buildPublicUrl(publicDomain, previewObject.key) && (
                    <Button variant="ghost" size="icon" onClick={() => copyText(buildPublicUrl(publicDomain, previewObject.key) || "")}>
                      <Copy size={15} />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" onClick={() => handleDownloadObject(previewObject)}>
                    <Download size={15} />
                  </Button>
                </div>
              </div>
              <div className="flex min-h-0 items-center justify-center overflow-auto bg-muted/30 p-4">
                <R2PreviewImage
                  accountScope={accountScope}
                  bucketName={selectedBucket.name}
                  object={previewObject}
                  publicUrl={buildPublicUrl(publicDomain, previewObject.key)}
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
