import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { readImage, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { readDir, readFile, stat } from "@tauri-apps/plugin-fs";
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
  Pin,
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
import { Textarea } from "@/components/ui/textarea";
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
  cancelDownloadR2Object,
  cancelUploadR2Object,
  copyR2Object,
  deleteR2Object,
  downloadR2Object,
  getR2BucketDomain,
  getR2BucketDomainsList,
  listR2Objects,
  moveR2Object,
  uploadR2Object,
  uploadR2ObjectBytes,
  uploadR2RemoteUrl,
  type BucketDomainsInfo,
  type FolderListing,
  type R2Bucket,
  type R2Object,
} from "@/lib/r2";
import { cn, formatBytes, orderPinnedFirst } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import {
  buildPreviewCacheKey,
  buildPublicUrl,
  buildThumbnailCacheKey,
  buildUploadPrefix as makeUploadPrefix,
  copyOutputLinesForKeys,
  CopyFormat,
  extensionForMime,
  fileNameFromKey,
  fileNameFromPath,
  fileNameFromUrl,
  folderLabel,
  folderPrefixForKey,
  formatCopyOutput,
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
  DEFAULT_R2_UPLOAD_SETTINGS,
  isCacheStale,
  r2BucketDomainCacheKey,
  R2_BUCKET_DOMAIN_CACHE_TTL_MS,
  r2ObjectListingCacheKey,
  r2PinnedBucketKey,
  r2UploadSettingsKey,
  useAppStore,
  type R2ImageOutputFormat,
  type R2UploadSettings,
  type R2UploadSettingsPatch,
} from "@/store/useAppStore";

const R2_PREFIX_PREFETCH_LIMIT = 4;

type TransferStatus = "queued" | "running" | "done" | "failed";
type ObjectActionMode = "copy" | "move";

interface TransferItem {
  id: string;
  kind: "upload" | "download";
  key: string;
  label: string;
  bucketName?: string;
  status: TransferStatus;
  progress: number;
  attempt?: number;
  error?: string;
}

interface R2UploadProgressEvent {
  upload_id: string;
  bucket_name: string;
  key: string;
  bytes_sent: number;
  total_bytes: number;
  progress: number;
}

interface R2DownloadProgressEvent {
  download_id: string;
  bucket_name: string;
  key: string;
  bytes_received: number;
  total_bytes: number;
  progress: number;
}

interface ObjectActionState {
  mode: ObjectActionMode;
  object: R2Object;
}

type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntry | null;
};

function inferImageMime(name: string, contentType?: string) {
  if (contentType?.startsWith("image/")) return contentType;
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.webp$/i.test(name)) return "image/webp";
  return "";
}

function supportedRasterFormat(name: string, contentType?: string): "jpeg" | "png" | "webp" | null {
  const mime = inferImageMime(name, contentType).toLowerCase();
  if (mime.includes("jpeg") || /\.jpe?g$/i.test(name)) return "jpeg";
  if (mime.includes("png") || /\.png$/i.test(name)) return "png";
  if (mime.includes("webp") || /\.webp$/i.test(name)) return "webp";
  return null;
}

function outputMimeForFormat(format: R2ImageOutputFormat, fallback: "jpeg" | "png" | "webp") {
  const resolved = format === "original" ? fallback : format;
  if (resolved === "jpeg") return "image/jpeg";
  if (resolved === "png") return "image/png";
  return "image/webp";
}

function extensionForImageFormat(format: R2ImageOutputFormat, fallback: "jpeg" | "png" | "webp") {
  const resolved = format === "original" ? fallback : format;
  return resolved === "jpeg" ? "jpg" : resolved;
}

function replaceImageExtension(name: string, extension: string) {
  const safeExtension = extension.replace(/^\./, "");
  if (/\.[^./\\]+$/.test(name)) return name.replace(/\.[^./\\]+$/, `.${safeExtension}`);
  return `${name}.${safeExtension}`;
}

function joinLocalPath(parent: string, child: string) {
  const separator = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return `${parent.replace(/[\\/]+$/, "")}${separator}${child}`;
}

function scaledImageSize(width: number, height: number, maxWidth: number | null, maxHeight: number | null) {
  const widthLimit = maxWidth && maxWidth > 0 ? maxWidth : width;
  const heightLimit = maxHeight && maxHeight > 0 ? maxHeight : height;
  const scale = Math.min(1, widthLimit / width, heightLimit / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function blobToImage(blob: Blob) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image could not be decoded."));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Image could not be encoded."));
        }
      },
      mimeType,
      quality
    );
  });
}

function BucketRow({
  bucket,
  active,
  pinned,
  onClick,
  onTogglePin,
}: {
  bucket: R2Bucket;
  active: boolean;
  pinned: boolean;
  onClick: () => void;
  onTogglePin: () => void;
}) {
  const { t } = useI18n();
  const pinLabel = pinned ? t("common.unpinFromTop") : t("common.pinToTop");

  return (
    <div
      className={cn(
        "group flex w-full items-center rounded-md text-sm transition-colors",
        active ? "bg-primary/10 text-primary" : "hover:bg-muted"
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2 text-left"
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
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={pinLabel}
              onClick={(event) => {
                event.stopPropagation();
                onTogglePin();
              }}
              className={cn(
                "mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-background/70 hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 group-hover:opacity-100",
                pinned && "bg-primary/10 text-primary opacity-100 hover:bg-primary/15 hover:text-primary"
              )}
            >
              <Pin size={13} strokeWidth={pinned ? 2.2 : 1.8} fill={pinned ? "currentColor" : "none"} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs">
            {pinLabel}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
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

function clampInteger(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
) {
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index], index);
    }
  });

  await Promise.all(runners);
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

async function optimizeUploadSource(source: UploadSource, settings: R2UploadSettings): Promise<UploadSource> {
  const imageSettings = settings.imageOptimization;
  if (!imageSettings.enabled) {
    return source;
  }

  const sourceName = source.name;
  const sourceFormat = supportedRasterFormat(sourceName, source.contentType);
  if (!sourceFormat) {
    return source;
  }

  let blob: Blob;
  if (source.file) {
    blob = source.file;
  } else if (source.localPath) {
    const bytes = await readFile(source.localPath);
    blob = new Blob([bytes], { type: inferImageMime(sourceName, source.contentType) || "application/octet-stream" });
  } else {
    return source;
  }

  const originalSize = blob.size;
  const image = await blobToImage(blob);
  const dimensions = scaledImageSize(
    image.naturalWidth,
    image.naturalHeight,
    imageSettings.maxWidth,
    imageSettings.maxHeight
  );
  const targetMime = outputMimeForFormat(imageSettings.outputFormat, sourceFormat);
  const targetExtension = extensionForImageFormat(imageSettings.outputFormat, sourceFormat);
  const targetName = replaceImageExtension(sourceName, targetExtension);

  const canvas = document.createElement("canvas");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available.");
  context.drawImage(image, 0, 0, dimensions.width, dimensions.height);

  const outputBlob = await canvasToBlob(
    canvas,
    targetMime,
    Math.min(100, Math.max(1, imageSettings.quality)) / 100
  );

  if (imageSettings.skipIfOutputLarger && outputBlob.size >= originalSize) {
    return {
      ...source,
      originalName: source.originalName || sourceName,
      originalSize,
      outputSize: originalSize,
      processingNote: "kept-original",
    };
  }

  const outputFile = new File([outputBlob], targetName, { type: targetMime });
  return {
    ...source,
    name: targetName,
    file: outputFile,
    localPath: undefined,
    contentType: targetMime,
    originalName: source.originalName || sourceName,
    originalSize,
    outputSize: outputBlob.size,
    processingNote: "optimized",
  };
}

async function collectDirectoryUploadSources(rootPath: string) {
  const rootName = fileNameFromPath(rootPath);
  const sources: UploadSource[] = [];

  async function visit(directoryPath: string, relativePrefix: string) {
    const entries = await readDir(directoryPath);
    for (const entry of entries) {
      const entryPath = joinLocalPath(directoryPath, entry.name);
      const relativeName = relativePrefix ? `${relativePrefix}/${entry.name}` : `${rootName}/${entry.name}`;
      if (entry.isDirectory) {
        await visit(entryPath, relativeName);
      } else if (entry.isFile) {
        sources.push({
          name: relativeName,
          localPath: entryPath,
        });
      }
    }
  }

  await visit(rootPath, "");
  return sources;
}

async function collectLocalPathUploadSources(paths: string[]) {
  const sources: UploadSource[] = [];

  for (const path of paths) {
    const info = await stat(path);
    if (info.isDirectory) {
      sources.push(...await collectDirectoryUploadSources(path));
    } else if (info.isFile) {
      sources.push({
        name: fileNameFromPath(path),
        localPath: path,
      });
    }
  }

  return sources;
}

function fileFromDroppedEntry(entry: FileSystemFileEntry) {
  return new Promise<File>((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

async function readDroppedDirectoryEntries(entry: FileSystemDirectoryEntry) {
  const reader = entry.createReader();
  const entries: FileSystemEntry[] = [];

  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) break;
    entries.push(...batch);
  }

  return entries;
}

async function collectDroppedEntryUploadSources(entry: FileSystemEntry, parentPath = ""): Promise<UploadSource[]> {
  const relativeName = parentPath ? `${parentPath}/${entry.name}` : entry.name;

  if (entry.isFile) {
    const file = await fileFromDroppedEntry(entry as FileSystemFileEntry);
    return [{
      name: relativeName,
      file,
      contentType: file.type || undefined,
    }];
  }

  if (entry.isDirectory) {
    const entries = await readDroppedDirectoryEntries(entry as FileSystemDirectoryEntry);
    const batches = await Promise.all(entries.map((child) => collectDroppedEntryUploadSources(child, relativeName)));
    return batches.flat();
  }

  return [];
}

async function collectDroppedUploadSources(dataTransfer: DataTransfer) {
  const entries = Array.from(dataTransfer.items ?? [])
    .map((item) => (item as DataTransferItemWithEntry).webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => Boolean(entry));

  if (entries.length > 0) {
    const batches = await Promise.all(entries.map((entry) => collectDroppedEntryUploadSources(entry)));
    return batches.flat();
  }

  return Array.from(dataTransfer.files ?? []).map((file) => ({
    name: file.webkitRelativePath || file.name,
    file,
    contentType: file.type || undefined,
  }));
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

function SettingLabel({
  htmlFor,
  label,
  help,
}: {
  htmlFor?: string;
  label: ReactNode;
  help: string;
}) {
  return (
    <details className="group space-y-1">
      <summary className="flex w-fit cursor-help list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
        <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
          {label}
        </Label>
        <span className="grid h-4 w-4 place-items-center rounded-full text-muted-foreground transition-colors group-open:bg-muted group-open:text-foreground">
          <Info size={11} aria-hidden="true" />
        </span>
      </summary>
      <p className="max-w-2xl text-[11px] leading-relaxed text-muted-foreground">{help}</p>
    </details>
  );
}

function SettingSection({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-md border border-border bg-background p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-muted text-muted-foreground">{icon}</span>
        {title}
      </div>
      {children}
    </section>
  );
}

export function R2BucketsView() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { state, refresh, isRefreshing: isRefreshingBuckets } = useR2Buckets();
  const objectRequestIdRef = useRef(0);
  const domainRequestIdRef = useRef(0);
  const prefetchInFlightRef = useRef<Set<string>>(new Set());
  const lastNativeDropAtRef = useRef(0);
  const setR2ObjectListing = useAppStore((s) => s.setR2ObjectListing);
  const setR2BucketDomain = useAppStore((s) => s.setR2BucketDomain);
  const setR2UploadSettings = useAppStore((s) => s.setR2UploadSettings);
  const activeAccount = useAppStore((s) => s.activeAccount);
  const cloudflareAccountId = useAppStore((s) => s.cloudflareAccountId);
  const r2ViewMode = useAppStore((s) => s.r2ViewMode);
  const r2SortField = useAppStore((s) => s.r2SortField);
  const r2SortDirection = useAppStore((s) => s.r2SortDirection);
  const setR2ViewMode = useAppStore((s) => s.setR2ViewMode);
  const setR2Sort = useAppStore((s) => s.setR2Sort);
  const pinnedR2BucketKeys = useAppStore((s) => s.pinnedR2BucketKeys);
  const togglePinnedR2Bucket = useAppStore((s) => s.togglePinnedR2Bucket);
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
  const [urlUploadOpen, setUrlUploadOpen] = useState(false);
  const [urlUploadText, setUrlUploadText] = useState("");
  const [objectAction, setObjectAction] = useState<ObjectActionState | null>(null);
  const [objectActionKey, setObjectActionKey] = useState("");
  const [objectActionRunning, setObjectActionRunning] = useState(false);
  const [uploadPrefixInput, setUploadPrefixInput] = useState("");
  const [uploadNameOverride, setUploadNameOverride] = useState("");
  const [useDatePrefix, setUseDatePrefix] = useState(false);
  const [copyFormat, setCopyFormat] = useState<CopyFormat>("url");
  const [copyTemplate, setCopyTemplate] = useState("{url}");
  const [conflictPolicy, setConflictPolicy] = useState<ConflictPolicy>("rename");
  const [cacheControl, setCacheControl] = useState("");
  const [transferConcurrency, setTransferConcurrency] = useState(DEFAULT_R2_UPLOAD_SETTINGS.transferConcurrency);
  const [retryCount, setRetryCount] = useState(DEFAULT_R2_UPLOAD_SETTINGS.retryCount);
  const [imageOptimizationEnabled, setImageOptimizationEnabled] = useState(false);
  const [imageOutputFormat, setImageOutputFormat] = useState<R2ImageOutputFormat>("webp");
  const [imageQuality, setImageQuality] = useState(82);
  const [imageMaxWidth, setImageMaxWidth] = useState<number | null>(2400);
  const [imageMaxHeight, setImageMaxHeight] = useState<number | null>(null);
  const [imageSkipIfLarger, setImageSkipIfLarger] = useState(true);
  const [preflightUploads, setPreflightUploads] = useState<PreparedUpload[] | null>(null);
  const preflightResolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  const buckets = state.status === "success" ? state.data : [];
  const currentDomainLabel = domainLabel(domainsInfo, publicDomain);
  const accountScope = activeAccount?.id || cloudflareAccountId || "default";
  const sortedBuckets = useMemo(
    () => orderPinnedFirst(buckets, pinnedR2BucketKeys, (bucket) => r2PinnedBucketKey(accountScope, bucket.name)),
    [accountScope, buckets, pinnedR2BucketKeys]
  );
  const uploadSettingsCacheKey = selectedBucket
    ? r2UploadSettingsKey(accountScope, selectedBucket.name)
    : null;
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
  const currentUploadSettings: R2UploadSettings = useMemo(
    () => ({
      ...DEFAULT_R2_UPLOAD_SETTINGS,
      uploadPrefixInput,
      useDatePrefix,
      copyFormat,
      copyTemplate,
      conflictPolicy,
      cacheControl,
      transferConcurrency,
      retryCount,
      imageOptimization: {
        enabled: imageOptimizationEnabled,
        outputFormat: imageOutputFormat,
        quality: imageQuality,
        maxWidth: imageMaxWidth,
        maxHeight: imageMaxHeight,
        skipIfOutputLarger: imageSkipIfLarger,
      },
    }),
    [
      cacheControl,
      conflictPolicy,
      copyFormat,
      copyTemplate,
      imageMaxHeight,
      imageMaxWidth,
      imageOptimizationEnabled,
      imageOutputFormat,
      imageQuality,
      imageSkipIfLarger,
      retryCount,
      transferConcurrency,
      uploadPrefixInput,
      useDatePrefix,
    ]
  );
  const uploadExampleKey = `${makeUploadPrefix(prefix, uploadPrefixInput, useDatePrefix)}example.png`;

  const persistUploadSettings = useCallback(
    (settings: R2UploadSettingsPatch) => {
      if (!uploadSettingsCacheKey) return;
      setR2UploadSettings(uploadSettingsCacheKey, settings);
    },
    [setR2UploadSettings, uploadSettingsCacheKey]
  );

  useEffect(() => {
    if (!uploadSettingsCacheKey) {
      setUploadPrefixInput(DEFAULT_R2_UPLOAD_SETTINGS.uploadPrefixInput);
      setUseDatePrefix(DEFAULT_R2_UPLOAD_SETTINGS.useDatePrefix);
      setCopyFormat(DEFAULT_R2_UPLOAD_SETTINGS.copyFormat);
      setCopyTemplate(DEFAULT_R2_UPLOAD_SETTINGS.copyTemplate);
      setConflictPolicy(DEFAULT_R2_UPLOAD_SETTINGS.conflictPolicy);
      setCacheControl(DEFAULT_R2_UPLOAD_SETTINGS.cacheControl);
      setTransferConcurrency(DEFAULT_R2_UPLOAD_SETTINGS.transferConcurrency);
      setRetryCount(DEFAULT_R2_UPLOAD_SETTINGS.retryCount);
      setImageOptimizationEnabled(DEFAULT_R2_UPLOAD_SETTINGS.imageOptimization.enabled);
      setImageOutputFormat(DEFAULT_R2_UPLOAD_SETTINGS.imageOptimization.outputFormat);
      setImageQuality(DEFAULT_R2_UPLOAD_SETTINGS.imageOptimization.quality);
      setImageMaxWidth(DEFAULT_R2_UPLOAD_SETTINGS.imageOptimization.maxWidth);
      setImageMaxHeight(DEFAULT_R2_UPLOAD_SETTINGS.imageOptimization.maxHeight);
      setImageSkipIfLarger(DEFAULT_R2_UPLOAD_SETTINGS.imageOptimization.skipIfOutputLarger);
      return;
    }

    const stored = useAppStore.getState().r2UploadSettings[uploadSettingsCacheKey];
    const settings = {
      ...DEFAULT_R2_UPLOAD_SETTINGS,
      ...stored,
    };
    setUploadPrefixInput(settings.uploadPrefixInput);
    setUseDatePrefix(settings.useDatePrefix);
    setCopyFormat(settings.copyFormat);
    setCopyTemplate(settings.copyTemplate);
    setConflictPolicy(settings.conflictPolicy);
    setCacheControl(settings.cacheControl);
    setTransferConcurrency(settings.transferConcurrency);
    setRetryCount(settings.retryCount);
    setImageOptimizationEnabled(settings.imageOptimization.enabled);
    setImageOutputFormat(settings.imageOptimization.outputFormat);
    setImageQuality(settings.imageOptimization.quality);
    setImageMaxWidth(settings.imageOptimization.maxWidth);
    setImageMaxHeight(settings.imageOptimization.maxHeight);
    setImageSkipIfLarger(settings.imageOptimization.skipIfOutputLarger);
  }, [uploadSettingsCacheKey]);

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
    if (!selectedBucket && sortedBuckets.length > 0) {
      setSelectedBucket(sortedBuckets[0]);
    }
  }, [selectedBucket, sortedBuckets]);

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

  useEffect(() => {
    let unsubscribeUpload: (() => void) | null = null;
    let unsubscribeDownload: (() => void) | null = null;
    listen<R2UploadProgressEvent>("r2-upload-progress", (event) => {
      updateTransfer(event.payload.upload_id, {
        bucketName: event.payload.bucket_name,
        key: event.payload.key,
        progress: Math.max(0, Math.min(99, Math.round(event.payload.progress))),
      });
    }).then((dispose) => {
      unsubscribeUpload = dispose;
    }).catch((err) => {
      console.warn("[CF Studio] Could not listen for R2 upload progress:", err);
    });
    listen<R2DownloadProgressEvent>("r2-download-progress", (event) => {
      updateTransfer(event.payload.download_id, {
        bucketName: event.payload.bucket_name,
        key: event.payload.key,
        progress: Math.max(0, Math.min(99, Math.round(event.payload.progress))),
      });
    }).then((dispose) => {
      unsubscribeDownload = dispose;
    }).catch((err) => {
      console.warn("[CF Studio] Could not listen for R2 download progress:", err);
    });
    return () => {
      unsubscribeUpload?.();
      unsubscribeDownload?.();
    };
  }, [updateTransfer]);

  const cancelTransfer = useCallback(async (item: TransferItem) => {
    if (item.status !== "running") return;
    try {
      if (item.kind === "upload") {
        await cancelUploadR2Object(item.id, item.bucketName || selectedBucket?.name || "", item.key);
        updateTransfer(item.id, { status: "failed", error: t("r2.uploadCancelled") });
      } else {
        await cancelDownloadR2Object(item.id, item.bucketName || selectedBucket?.name || "", item.key);
        updateTransfer(item.id, { status: "failed", error: t("r2.downloadCancelled") });
      }
    } catch (err) {
      toast({ title: t("r2.objectActionFailed"), description: String(err), variant: "destructive" });
    }
  }, [selectedBucket?.name, t, toast, updateTransfer]);

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

  const requestUploadPreflight = useCallback((items: PreparedUpload[]) => {
    return new Promise<boolean>((resolve) => {
      preflightResolveRef.current = resolve;
      setPreflightUploads(items);
    });
  }, []);

  const closeUploadPreflight = useCallback((confirmed: boolean) => {
    preflightResolveRef.current?.(confirmed);
    preflightResolveRef.current = null;
    setPreflightUploads(null);
  }, []);

  const uploadSources = useCallback(
    async (sources: UploadSource[]) => {
      if (!selectedBucket || sources.length === 0) return;
      setUploading(true);

      try {
        const uploadSources = await Promise.all(
          sources.map(async (source) => {
            try {
              return await optimizeUploadSource(source, currentUploadSettings);
            } catch (err) {
              console.warn("[CF Studio] Image optimization failed:", err);
              return {
                ...source,
                processingNote: "optimize-failed",
              };
            }
          })
        );
        const plan = planUploads(uploadSources);
        const preparedUploads = await prepareUploads(selectedBucket.name, plan);
        if (preparedUploads.length === 0) {
          toast({ title: t("r2.uploadSkipped"), description: t("r2.uploadSkippedDesc") });
          return;
        }

        const shouldConfirmPreflight = preparedUploads.length > 1 || preparedUploads.some((item) =>
          item.originalKey !== item.key ||
          Boolean(item.source.processingNote) ||
          item.source.originalSize != null ||
          item.source.outputSize != null
        );
        if (shouldConfirmPreflight) {
          const confirmed = await requestUploadPreflight(preparedUploads);
          if (!confirmed) {
            toast({ title: t("r2.uploadCancelled") });
            return;
          }
        }

        const uploadResults: Array<{ key: string; ok: boolean; error?: string }> = preparedUploads.map((item) => ({
          key: item.key,
          ok: false,
        }));
        const normalizedConcurrency = clampInteger(transferConcurrency, 1, 5, DEFAULT_R2_UPLOAD_SETTINGS.transferConcurrency);
        const normalizedRetryCount = clampInteger(retryCount, 0, 3, DEFAULT_R2_UPLOAD_SETTINGS.retryCount);

        await runWithConcurrency(preparedUploads, normalizedConcurrency, async (item, index) => {
          const transferId = addTransfer({
            kind: "upload",
            bucketName: selectedBucket.name,
            key: item.key,
            label: fileNameFromKey(item.key),
          });

          for (let attempt = 0; attempt <= normalizedRetryCount; attempt += 1) {
            try {
              updateTransfer(transferId, {
                status: "running",
                progress: attempt === 0 ? 20 : 5,
                attempt: attempt + 1,
                error: undefined,
              });
              if (item.source.localPath) {
                await uploadR2Object(selectedBucket.name, item.key, item.source.localPath, transferId, cacheControl.trim() || undefined);
              } else if (item.source.file) {
                const buffer = await item.source.file.arrayBuffer();
                const bytes = Array.from(new Uint8Array(buffer));
                updateTransfer(transferId, { progress: 45 });
                await uploadR2ObjectBytes(selectedBucket.name, item.key, bytes, item.contentType, cacheControl.trim() || undefined);
              } else if (item.source.remoteUrl) {
                updateTransfer(transferId, { progress: 45 });
                await uploadR2RemoteUrl(selectedBucket.name, item.key, item.source.remoteUrl, cacheControl.trim() || undefined);
              } else {
                throw new Error("Missing upload source.");
              }
              updateTransfer(transferId, { status: "done", progress: 100 });
              uploadResults[index] = { key: item.key, ok: true };
              return;
            } catch (err) {
              const message = String(err);
              if (message.toLowerCase().includes("cancel")) {
                updateTransfer(transferId, { status: "failed", progress: 100, error: t("r2.uploadCancelled") });
                uploadResults[index] = { key: item.key, ok: false, error: t("r2.uploadCancelled") };
                return;
              }
              if (attempt < normalizedRetryCount) {
                updateTransfer(transferId, {
                  status: "queued",
                  progress: 0,
                  error: t("r2.retryingUpload", { attempt: attempt + 2 }),
                });
                continue;
              }
              updateTransfer(transferId, { status: "failed", progress: 100, error: message });
              uploadResults[index] = { key: item.key, ok: false, error: message };
              return;
            }
          }
        });

        const successfulKeys = uploadResults.filter((item) => item.ok).map((item) => item.key);
        const failedCount = uploadResults.filter((item) => !item.ok).length;
        const firstUploadError = uploadResults.find((item) => !item.ok)?.error ?? null;

        if (successfulKeys.length === 0 && firstUploadError) {
          throw new Error(firstUploadError);
        }

        await reloadObjects();
        const uploadPrefixes = Array.from(new Set(preparedUploads.map((item) => folderPrefixForKey(item.key))));
        uploadPrefixes.forEach((targetPrefix) => {
          if (targetPrefix !== prefix) {
            prefetchR2Prefix(targetPrefix);
          }
        });

        const copiedText = copyOutputLinesForKeys(successfulKeys, publicDomain, copyFormat, copyTemplate);

        if (copiedText) {
          const copied = await tryCopyText(copiedText);
          toast({
            title: copied
              ? failedCount > 0
                ? t("r2.uploadPartialCopied", { success: successfulKeys.length, failed: failedCount })
                : t("r2.uploadCopied")
              : t("r2.uploadedCopyFailed"),
            description: copied ? copiedText : t("r2.copyFailedDesc"),
            variant: copied ? "default" : "destructive",
          });
        } else if (failedCount > 0) {
          toast({
            title: t("r2.uploadPartial", { success: successfulKeys.length, failed: failedCount }),
            description: t("r2.noPublicDomainCopy"),
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
      copyTemplate,
      cacheControl,
      currentUploadSettings,
      planUploads,
      prefetchR2Prefix,
      prefix,
      prepareUploads,
      publicDomain,
      requestUploadPreflight,
      retryCount,
      reloadObjects,
      selectedBucket,
      t,
      toast,
      tryCopyText,
      transferConcurrency,
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
      try {
        const sources = await collectLocalPathUploadSources(paths);
        if (sources.length === 0) {
          toast({ title: t("r2.folderUploadEmpty") });
          return;
        }
        await uploadSources(sources);
      } catch (err) {
        toast({ title: t("r2.localUploadReadFailed"), description: String(err), variant: "destructive" });
      }
    },
    [t, toast, uploadSources]
  );

  const submitUrlUpload = useCallback(async () => {
    const sources = urlUploadText
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
      .map((remoteUrl) => ({
        name: fileNameFromUrl(remoteUrl),
        remoteUrl,
      }));

    if (sources.length === 0) {
      toast({ title: t("r2.urlUploadEmpty"), variant: "destructive" });
      return;
    }

    setUrlUploadOpen(false);
    setUrlUploadText("");
    await uploadSources(sources);
  }, [t, toast, uploadSources, urlUploadText]);

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
    } catch {
      return;
    }
  }, [uploadFiles]);

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
    if (!selectedBucket) {
      setDragActive(false);
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (uploading) return;

        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setDragActive(true);
          return;
        }

        if (payload.type === "leave") {
          setDragActive(false);
          return;
        }

        if (payload.type === "drop") {
          setDragActive(false);
          if (payload.paths.length > 0) {
            lastNativeDropAtRef.current = Date.now();
            void uploadLocalPaths(payload.paths);
          }
        }
      })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
        } else {
          unlisten = cleanup;
        }
      })
      .catch((err) => {
        console.warn("[CF Studio] Native file drop listener failed:", err);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [selectedBucket, uploadLocalPaths, uploading]);

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
    const confirmed = await ask(t("r2.deleteObjectConfirm", { key }), {
      title: t("r2.delete"),
      kind: "warning",
      okLabel: t("r2.delete"),
      cancelLabel: t("common.cancel"),
    });
    if (!confirmed) return;

    try {
      await deleteR2Object(selectedBucket.name, key);
      await reloadObjects();
    } catch (err) {
      toast({ title: t("r2.objectActionFailed"), description: String(err), variant: "destructive" });
    }
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
    const destinationExists = (listing?.files ?? []).some((item) => item.key === destinationKey);
    if (objectAction.mode === "copy" && destinationExists) {
      const confirmed = await ask(t("r2.copyOverwriteConfirm", { key: destinationKey }), {
        title: t("r2.copyObject"),
        kind: "warning",
        okLabel: t("r2.copyObject"),
        cancelLabel: t("common.cancel"),
      });
      if (!confirmed) return;
    }
    if (objectAction.mode === "move") {
      const confirmed = await ask(t("r2.moveObjectConfirm", {
        source: objectAction.object.key,
        destination: destinationKey,
      }), {
        title: t("r2.moveObject"),
        kind: "warning",
        okLabel: t("r2.moveObject"),
        cancelLabel: t("common.cancel"),
      });
      if (!confirmed) return;
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
    listing?.files,
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

      const normalizedConcurrency = clampInteger(transferConcurrency, 1, 5, DEFAULT_R2_UPLOAD_SETTINGS.transferConcurrency);
      const normalizedRetryCount = clampInteger(retryCount, 0, 3, DEFAULT_R2_UPLOAD_SETTINGS.retryCount);
      const downloadResults: Array<{ key: string; ok: boolean; error?: string }> = objects.map((object) => ({
        key: object.key,
        ok: false,
      }));

      await runWithConcurrency(objects, normalizedConcurrency, async (object, index) => {
        const transferId = addTransfer({
          kind: "download",
          bucketName: selectedBucket.name,
          key: object.key,
          label: fileNameFromKey(object.key),
        });
        const destinationPath = joinLocalPath(directory, fileNameFromKey(object.key));

        for (let attempt = 0; attempt <= normalizedRetryCount; attempt += 1) {
          try {
            updateTransfer(transferId, {
              status: "running",
              progress: attempt === 0 ? 5 : 0,
              attempt: attempt + 1,
              error: undefined,
            });
            await downloadR2Object(selectedBucket.name, object.key, destinationPath, transferId);
            updateTransfer(transferId, { status: "done", progress: 100 });
            downloadResults[index] = { key: object.key, ok: true };
            return;
          } catch (err) {
            const message = String(err);
            if (message.toLowerCase().includes("cancel")) {
              updateTransfer(transferId, { status: "failed", progress: 100, error: t("r2.downloadCancelled") });
              downloadResults[index] = { key: object.key, ok: false, error: t("r2.downloadCancelled") };
              return;
            }
            if (attempt < normalizedRetryCount) {
              updateTransfer(transferId, {
                status: "queued",
                progress: 0,
                error: t("r2.retryingDownload", { attempt: attempt + 2 }),
              });
              continue;
            }
            updateTransfer(transferId, { status: "failed", progress: 100, error: message });
            downloadResults[index] = { key: object.key, ok: false, error: message };
            return;
          }
        }

      });

      const failedCount = downloadResults.filter((item) => !item.ok).length;
      if (failedCount > 0) {
        toast({
          title: t("r2.downloadFailed"),
          description: downloadResults.find((item) => !item.ok)?.error,
          variant: "destructive",
        });
      } else {
        toast({ title: t("r2.downloaded"), description: directory });
      }
    },
    [addTransfer, retryCount, selectedBucket, t, toast, transferConcurrency, updateTransfer]
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

  const copySelectedTemplate = useCallback(async () => {
    const value = copyOutputLinesForKeys(
      currentSelectedObjects.map((object) => object.key),
      publicDomain,
      copyFormat,
      copyTemplate
    );
    if (value) {
      await copyText(value, t("r2.copyCustom"));
    }
  }, [copyFormat, copyTemplate, copyText, currentSelectedObjects, publicDomain, t]);

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (Date.now() - lastNativeDropAtRef.current < 600) return;

    try {
      const sources = await collectDroppedUploadSources(event.dataTransfer);
      if (sources.length === 0) {
        toast({ title: t("r2.uploadSkipped"), description: t("r2.dropNoFiles") });
        return;
      }
      await uploadSources(sources);
    } catch (err) {
      toast({ title: t("r2.localUploadReadFailed"), description: String(err), variant: "destructive" });
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (selectedBucket && !uploading) {
      setDragActive(true);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragActive(false);
    }
  };

  return (
    <div className="relative flex h-full flex-col gap-5">
      {dragActive && selectedBucket && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-lg bg-background/70 p-6 backdrop-blur-sm">
          <div className="flex min-w-72 flex-col items-center rounded-lg border border-dashed border-primary bg-background px-6 py-5 text-center shadow-lg">
            <Upload size={24} className="mb-3 text-primary" />
            <p className="text-sm font-semibold text-foreground">{t("r2.dropToUpload")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("r2.dropToUploadDesc", { bucket: selectedBucket.name })}
            </p>
          </div>
        </div>
      )}

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
            {t("r2.pasteImage")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setUrlUploadOpen(true)} disabled={!selectedBucket || uploading}>
            <Globe2 size={14} className="mr-2" />
            {t("r2.uploadUrls")}
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
            {sortedBuckets.map((bucket) => {
              const pinKey = r2PinnedBucketKey(accountScope, bucket.name);
              return (
                <BucketRow
                  key={bucket.name}
                  bucket={bucket}
                  active={selectedBucket?.name === bucket.name}
                  pinned={pinnedR2BucketKeys.includes(pinKey)}
                  onTogglePin={() => togglePinnedR2Bucket(pinKey)}
                  onClick={() => {
                    setSelectedBucket(bucket);
                    setPrefix("");
                  }}
                />
              );
            })}
          </div>
        </aside>

        <section
          className={cn("relative min-h-0 overflow-auto bg-background", dragActive && "bg-primary/5")}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
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
                  {copyFormat === "custom" && (
                    <Button variant="outline" size="sm" className="h-7" onClick={copySelectedTemplate} disabled={!publicDomain}>
                      <Copy size={12} className="mr-1.5" />
                      {t("r2.copyCustom")}
                    </Button>
                  )}
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
                  {item.attempt && item.attempt > 1 && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {t("r2.transferAttempt", { attempt: item.attempt })}
                    </p>
                  )}
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full bg-primary", item.status === "failed" && "bg-destructive")}
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                  {item.error && <p className="mt-1 truncate text-destructive">{item.error}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {item.status === "running" && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => cancelTransfer(item)} title={t("common.cancel")}>
                      <X size={13} />
                    </Button>
                  )}
                  <Badge variant={item.status === "failed" ? "destructive" : "secondary"} className="text-[10px]">
                    {t(transferStatusKey(item.status))}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="!flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="border-b border-border px-6 py-4 pr-12">
            <DialogTitle>{t("r2.uploadSettings")}</DialogTitle>
            <DialogDescription>{t("r2.uploadSettingsDesc")}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <div className="space-y-4">
              <SettingSection icon={<Folder size={14} />} title={t("r2.uploadDestinationSection")}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="min-w-0 space-y-1.5">
                    <SettingLabel
                      htmlFor="r2-upload-prefix"
                      label={t("r2.uploadPrefix")}
                      help={t("r2.uploadPrefixHelp")}
                    />
                    <Input
                      id="r2-upload-prefix"
                      value={uploadPrefixInput}
                      onChange={(event) => {
                        setUploadPrefixInput(event.target.value);
                        persistUploadSettings({ uploadPrefixInput: event.target.value });
                      }}
                      placeholder={prefix || t("r2.uploadPrefixPlaceholder")}
                      className="h-9"
                    />
                  </div>
                  <div className="flex items-start gap-2 rounded-md bg-muted/35 p-3">
                    <Checkbox
                      id="r2-date-prefix"
                      checked={useDatePrefix}
                      onCheckedChange={(checked) => {
                        const enabled = checked === true;
                        setUseDatePrefix(enabled);
                        persistUploadSettings({ useDatePrefix: enabled });
                      }}
                    />
                    <SettingLabel
                      htmlFor="r2-date-prefix"
                      label={
                        <span className="flex items-center gap-1.5">
                          <CalendarDays size={13} />
                          {t("r2.datePrefix")}
                        </span>
                      }
                      help={t("r2.datePrefixHelp")}
                    />
                  </div>
                </div>
                <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-xs">
                  <span className="text-muted-foreground">{t("r2.uploadPathPreview")}</span>
                  <span className="ml-2 break-all font-mono">/{uploadExampleKey}</span>
                </div>
              </SettingSection>

              <SettingSection icon={<Pencil size={14} />} title={t("r2.namingSection")}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="min-w-0 space-y-1.5">
                    <SettingLabel
                      htmlFor="r2-upload-name"
                      label={t("r2.uploadName")}
                      help={t("r2.uploadNameHelp")}
                    />
                    <Input
                      id="r2-upload-name"
                      value={uploadNameOverride}
                      onChange={(event) => setUploadNameOverride(event.target.value)}
                      placeholder={t("r2.uploadNamePlaceholder")}
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <SettingLabel label={t("r2.conflictPolicy")} help={t("r2.conflictPolicyHelp")} />
                    <Select
                      value={conflictPolicy}
                      onValueChange={(value) => {
                        const next = value as ConflictPolicy;
                        setConflictPolicy(next);
                        persistUploadSettings({ conflictPolicy: next });
                      }}
                    >
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
                </div>
              </SettingSection>

              <SettingSection icon={<Copy size={14} />} title={t("r2.copySection")}>
                <div className="space-y-1.5">
                  <SettingLabel label={t("r2.copyFormat")} help={t("r2.copyFormatHelp")} />
                  <Select
                    value={copyFormat}
                    onValueChange={(value) => {
                      const next = value as CopyFormat;
                      setCopyFormat(next);
                      persistUploadSettings({ copyFormat: next });
                    }}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="url">{t("r2.copyUrlFormat")}</SelectItem>
                      <SelectItem value="markdown">{t("r2.copyMarkdownFormat")}</SelectItem>
                      <SelectItem value="html">{t("r2.copyHtmlFormat")}</SelectItem>
                      <SelectItem value="custom">{t("r2.copyCustomFormat")}</SelectItem>
                    </SelectContent>
                  </Select>
                  {copyFormat === "custom" && (
                    <div className="space-y-1.5 pt-2">
                      <SettingLabel
                        htmlFor="r2-copy-template"
                        label={t("r2.copyTemplate")}
                        help={t("r2.copyTemplateHelp")}
                      />
                      <Input
                        id="r2-copy-template"
                        value={copyTemplate}
                        onChange={(event) => {
                          setCopyTemplate(event.target.value);
                          persistUploadSettings({ copyTemplate: event.target.value });
                        }}
                        placeholder="{url}"
                        className="h-9 font-mono text-xs"
                      />
                      <p className="break-all rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                        {formatCopyOutput(
                          "https://assets.example.com/images/example.png",
                          "images/example.png",
                          "custom",
                          copyTemplate
                        )}
                      </p>
                    </div>
                  )}
                </div>
              </SettingSection>

              <SettingSection icon={<Upload size={14} />} title={t("r2.transferSection")}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <SettingLabel
                      htmlFor="r2-transfer-concurrency"
                      label={t("r2.transferConcurrency")}
                      help={t("r2.transferConcurrencyHelp")}
                    />
                    <Input
                      id="r2-transfer-concurrency"
                      type="number"
                      min={1}
                      max={5}
                      value={transferConcurrency}
                      onChange={(event) => {
                        const next = clampInteger(Number(event.target.value), 1, 5, DEFAULT_R2_UPLOAD_SETTINGS.transferConcurrency);
                        setTransferConcurrency(next);
                        persistUploadSettings({ transferConcurrency: next });
                      }}
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <SettingLabel
                      htmlFor="r2-retry-count"
                      label={t("r2.retryCount")}
                      help={t("r2.retryCountHelp")}
                    />
                    <Input
                      id="r2-retry-count"
                      type="number"
                      min={0}
                      max={3}
                      value={retryCount}
                      onChange={(event) => {
                        const next = clampInteger(Number(event.target.value), 0, 3, DEFAULT_R2_UPLOAD_SETTINGS.retryCount);
                        setRetryCount(next);
                        persistUploadSettings({ retryCount: next });
                      }}
                      className="h-9"
                    />
                  </div>
                </div>
                <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  {t("r2.uploadPathStatus")}
                </div>
              </SettingSection>

              <SettingSection icon={<ImageIcon size={14} />} title={t("r2.imageSection")}>
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <SettingLabel
                        htmlFor="r2-image-optimization"
                        label={t("r2.imageOptimization")}
                        help={t("r2.imageOptimizationHelp")}
                      />
                    </div>
                    <Checkbox
                      id="r2-image-optimization"
                      checked={imageOptimizationEnabled}
                      onCheckedChange={(checked) => {
                        const enabled = checked === true;
                        setImageOptimizationEnabled(enabled);
                        persistUploadSettings({ imageOptimization: { enabled } });
                      }}
                    />
                  </div>
                  {imageOptimizationEnabled && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <SettingLabel label={t("r2.imageOutputFormat")} help={t("r2.imageOutputFormatHelp")} />
                        <Select
                          value={imageOutputFormat}
                          onValueChange={(value) => {
                            const next = value as R2ImageOutputFormat;
                            setImageOutputFormat(next);
                            persistUploadSettings({ imageOptimization: { outputFormat: next } });
                          }}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="original">{t("r2.imageFormatOriginal")}</SelectItem>
                            <SelectItem value="webp">WebP</SelectItem>
                            <SelectItem value="jpeg">JPEG</SelectItem>
                            <SelectItem value="png">PNG</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <SettingLabel
                          htmlFor="r2-image-quality"
                          label={t("r2.imageQuality")}
                          help={t("r2.imageQualityHelp")}
                        />
                        <Input
                          id="r2-image-quality"
                          type="number"
                          min={1}
                          max={100}
                          value={imageQuality}
                          onChange={(event) => {
                            const next = Math.min(100, Math.max(1, Number(event.target.value) || DEFAULT_R2_UPLOAD_SETTINGS.imageOptimization.quality));
                            setImageQuality(next);
                            persistUploadSettings({ imageOptimization: { quality: next } });
                          }}
                          className="h-9"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <SettingLabel
                          htmlFor="r2-image-max-width"
                          label={t("r2.imageMaxWidth")}
                          help={t("r2.imageMaxWidthHelp")}
                        />
                        <Input
                          id="r2-image-max-width"
                          type="number"
                          min={1}
                          value={imageMaxWidth ?? ""}
                          onChange={(event) => {
                            const next = event.target.value ? Math.max(1, Number(event.target.value)) : null;
                            setImageMaxWidth(next);
                            persistUploadSettings({ imageOptimization: { maxWidth: next } });
                          }}
                          placeholder="2400"
                          className="h-9"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <SettingLabel
                          htmlFor="r2-image-max-height"
                          label={t("r2.imageMaxHeight")}
                          help={t("r2.imageMaxHeightHelp")}
                        />
                        <Input
                          id="r2-image-max-height"
                          type="number"
                          min={1}
                          value={imageMaxHeight ?? ""}
                          onChange={(event) => {
                            const next = event.target.value ? Math.max(1, Number(event.target.value)) : null;
                            setImageMaxHeight(next);
                            persistUploadSettings({ imageOptimization: { maxHeight: next } });
                          }}
                          placeholder={t("common.notAvailable")}
                          className="h-9"
                        />
                      </div>
                      <div className="flex items-start gap-2 rounded-md bg-muted/35 p-3 sm:col-span-2">
                        <Checkbox
                          id="r2-image-skip-larger"
                          checked={imageSkipIfLarger}
                          onCheckedChange={(checked) => {
                            const enabled = checked === true;
                            setImageSkipIfLarger(enabled);
                            persistUploadSettings({ imageOptimization: { skipIfOutputLarger: enabled } });
                          }}
                        />
                        <div className="space-y-1">
                          <SettingLabel
                            htmlFor="r2-image-skip-larger"
                            label={t("r2.imageSkipIfLarger")}
                            help={t("r2.imageSkipIfLargerHelp")}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </SettingSection>

              <SettingSection icon={<Info size={14} />} title={t("r2.cacheSection")}>
                <div className="space-y-1.5">
                  <SettingLabel
                    htmlFor="r2-cache-control"
                    label={t("r2.cacheControl")}
                    help={t("r2.cacheControlHelp")}
                  />
                  <Input
                    id="r2-cache-control"
                    value={cacheControl}
                    onChange={(event) => {
                      setCacheControl(event.target.value);
                      persistUploadSettings({ cacheControl: event.target.value });
                    }}
                    placeholder="public, max-age=31536000, immutable"
                    className="h-9 font-mono text-xs"
                  />
                </div>
              </SettingSection>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={urlUploadOpen} onOpenChange={setUrlUploadOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("r2.urlUploadTitle")}</DialogTitle>
            <DialogDescription>{t("r2.urlUploadDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              value={urlUploadText}
              onChange={(event) => setUrlUploadText(event.target.value)}
              placeholder={"https://example.com/image-a.png\nhttps://example.com/file.zip"}
              className="min-h-40 font-mono text-xs"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setUrlUploadOpen(false)} disabled={uploading}>
                {t("common.cancel")}
              </Button>
              <Button onClick={submitUrlUpload} disabled={uploading}>
                {t("r2.addUrlsToUpload")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!preflightUploads} onOpenChange={(open) => !open && closeUploadPreflight(false)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t("r2.preflightTitle")}</DialogTitle>
            <DialogDescription>{t("r2.preflightDesc")}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[52vh] overflow-auto rounded-md border border-border">
            <div className="grid grid-cols-[1.3fr_1.7fr_0.9fr_0.9fr] gap-3 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
              <span>{t("r2.preflightSource")}</span>
              <span>{t("r2.preflightKey")}</span>
              <span>{t("r2.preflightSize")}</span>
              <span>{t("r2.preflightStatus")}</span>
            </div>
            <div className="divide-y divide-border">
              {(preflightUploads ?? []).map((item) => {
                const originalSize = item.source.originalSize;
                const outputSize = item.source.outputSize;
                const optimized = originalSize != null && outputSize != null && outputSize < originalSize;
                const keptOriginal = item.source.processingNote === "kept-original";
                const optimizeFailed = item.source.processingNote === "optimize-failed";
                const renamed = item.originalKey !== item.key;

                return (
                  <div key={`${item.originalKey}:${item.key}`} className="grid grid-cols-[1.3fr_1.7fr_0.9fr_0.9fr] gap-3 px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{item.source.originalName || item.source.name}</p>
                      {item.source.originalName && item.source.originalName !== item.source.name && (
                        <p className="truncate text-muted-foreground">{item.source.name}</p>
                      )}
                    </div>
                    <p className="break-all font-mono text-[11px]">{item.key}</p>
                    <div className="space-y-0.5 text-muted-foreground">
                      {originalSize != null && <p>{formatBytes(originalSize)}</p>}
                      {outputSize != null && outputSize !== originalSize && <p>{formatBytes(outputSize)}</p>}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {optimized && <Badge variant="secondary" className="text-[10px]">{t("r2.preflightOptimized")}</Badge>}
                      {keptOriginal && <Badge variant="outline" className="text-[10px]">{t("r2.preflightKeptOriginal")}</Badge>}
                      {optimizeFailed && <Badge variant="destructive" className="text-[10px]">{t("r2.preflightOptimizeFailed")}</Badge>}
                      {renamed && <Badge variant="secondary" className="text-[10px]">{t("r2.preflightRenamed")}</Badge>}
                      {!optimized && !keptOriginal && !optimizeFailed && !renamed && (
                        <span className="text-muted-foreground">{t("r2.preflightReady")}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => closeUploadPreflight(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => closeUploadPreflight(true)}>
              {t("r2.startUpload")}
            </Button>
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
