import type { R2Object } from "@/lib/r2";

export type R2ViewMode = "list" | "grid";
export type R2SortField = "name" | "size" | "updated" | "type";
export type R2SortDirection = "asc" | "desc";
export type CopyFormat = "url" | "markdown" | "html" | "custom";
export type ConflictPolicy = "overwrite" | "rename" | "skip";

export interface UploadSource {
  name: string;
  file?: File;
  localPath?: string;
  remoteUrl?: string;
  contentType?: string;
  originalName?: string;
  originalSize?: number;
  outputSize?: number;
  processingNote?: string;
}

export interface PlannedUpload {
  source: UploadSource;
  key: string;
  contentType?: string;
}

export interface PreparedUpload {
  source: UploadSource;
  originalKey: string;
  key: string;
  contentType?: string;
  skipped?: boolean;
}

export function encodeR2Key(key: string) {
  return key.split("/").map(encodeURIComponent).join("/");
}

export function buildPublicUrl(domain: string | null, key: string) {
  if (!domain) return null;
  return `${domain.replace(/\/+$/, "")}/${encodeR2Key(key)}`;
}

export function fileNameFromKey(key: string) {
  return key.split("/").filter(Boolean).pop() || "r2-object";
}

export function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || "r2-object";
}

export function fileNameFromUrl(value: string) {
  try {
    const url = new URL(value);
    const name = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
    return name || "remote-file";
  } catch {
    return "remote-file";
  }
}

export function extensionForMime(type: string) {
  const [, subtype = "png"] = type.split("/");
  if (subtype === "jpeg") return "jpg";
  if (subtype === "svg+xml") return "svg";
  return subtype.split("+")[0] || "png";
}

export function isImageObject(key: string) {
  return /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(key);
}

export function normalizePrefix(value: string) {
  const trimmed = value.trim().replace(/^\/+/, "");
  if (!trimmed) return "";
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

export function datePrefix(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}/`;
}

export function folderPrefixForKey(key: string) {
  const index = key.lastIndexOf("/");
  return index >= 0 ? key.slice(0, index + 1) : "";
}

export function splitFileName(name: string) {
  const index = name.lastIndexOf(".");
  if (index <= 0) return { base: name, ext: "" };
  return { base: name.slice(0, index), ext: name.slice(index) };
}

export function nextAvailableKey(key: string, existing: Set<string>, reserved: Set<string>) {
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

export function objectLabel(key: string, prefix: string) {
  return key.replace(prefix, "") || key;
}

export function objectTypeLabel(key: string) {
  const name = fileNameFromKey(key);
  const extension = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";
  return extension || "file";
}

export function markdownImage(url: string, key: string) {
  return `![${fileNameFromKey(key)}](${url})`;
}

export function markdownLink(url: string, key: string) {
  const name = fileNameFromKey(key);
  return isImageObject(key) ? `![${name}](${url})` : `[${name}](${url})`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function htmlLink(url: string, key: string) {
  const name = fileNameFromKey(key);
  const safeUrl = escapeHtml(url);
  const safeName = escapeHtml(name);
  return isImageObject(key)
    ? `<img src="${safeUrl}" alt="${safeName}" />`
    : `<a href="${safeUrl}">${safeName}</a>`;
}

export function formatCustomCopyOutput(template: string, url: string, key: string) {
  const name = fileNameFromKey(key);
  const resolvedTemplate = template.trim() || "{url}";
  return resolvedTemplate
    .split("{url}").join(url)
    .split("{key}").join(key)
    .split("{name}").join(name);
}

export function formatCopyOutput(url: string, key: string, format: CopyFormat, customTemplate = "{url}") {
  if (format === "custom") return formatCustomCopyOutput(customTemplate, url, key);
  if (format === "markdown") return markdownLink(url, key);
  if (format === "html") return htmlLink(url, key);
  return url;
}

export function copyOutputLinesForKeys(keys: string[], publicDomain: string | null, format: CopyFormat, customTemplate = "{url}") {
  return keys
    .map((key) => {
      const url = buildPublicUrl(publicDomain, key);
      return url ? formatCopyOutput(url, key, format, customTemplate) : null;
    })
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

export function buildThumbnailCacheKey(accountId: string, bucketName: string, object: R2Object) {
  return ["thumb-v1", accountId || "default", bucketName, object.key, object.etag || object.uploaded].join("::");
}

export function buildPreviewCacheKey(accountId: string, bucketName: string, object: R2Object, maxDimension: number) {
  return ["preview-v1", maxDimension, accountId || "default", bucketName, object.key, object.etag || object.uploaded].join("::");
}

export function buildUploadPrefix(prefix: string, uploadPrefixInput: string, useDatePrefix: boolean, date = new Date()) {
  const basePrefix = normalizePrefix(uploadPrefixInput || prefix);
  return `${basePrefix}${useDatePrefix ? datePrefix(date) : ""}`;
}

export function planUploadSources(
  sources: UploadSource[],
  uploadPrefix: string,
  uploadNameOverride: string
): PlannedUpload[] {
  return sources.map((source) => {
    const customName = sources.length === 1 ? uploadNameOverride.trim().replace(/^\/+/, "") : "";
    const objectName = customName || source.name;
    return {
      source,
      key: `${uploadPrefix}${objectName}`,
      contentType: source.contentType,
    };
  });
}

export function prepareUploadPlan(
  plan: PlannedUpload[],
  existing: Set<string>,
  conflictPolicy: ConflictPolicy
): PreparedUpload[] {
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
}

export function sortR2Objects(
  objects: R2Object[],
  sortField: R2SortField,
  direction: R2SortDirection
) {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...objects].sort((a, b) => {
    if (sortField === "size") {
      return (a.size - b.size) * multiplier;
    }

    if (sortField === "updated") {
      return (new Date(a.uploaded).getTime() - new Date(b.uploaded).getTime()) * multiplier;
    }

    if (sortField === "type") {
      return objectTypeLabel(a.key).localeCompare(objectTypeLabel(b.key)) * multiplier;
    }

    return fileNameFromKey(a.key).localeCompare(fileNameFromKey(b.key)) * multiplier;
  });
}

export function folderLabel(folder: string, prefix: string) {
  return folder.replace(prefix, "") || folder;
}

export function selectedObjects(objects: R2Object[], selectedKeys: Set<string>) {
  return objects.filter((object) => selectedKeys.has(object.key));
}

export function publicUrlLines(objects: R2Object[], publicDomain: string | null) {
  return objects
    .map((object) => buildPublicUrl(publicDomain, object.key))
    .filter((url): url is string => Boolean(url))
    .join("\n");
}

export function markdownImageLines(objects: R2Object[], publicDomain: string | null) {
  return objects
    .map((object) => {
      const url = buildPublicUrl(publicDomain, object.key);
      return url && isImageObject(object.key) ? markdownImage(url, object.key) : null;
    })
    .filter((value): value is string => Boolean(value))
    .join("\n");
}
