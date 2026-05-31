// useAppStore.ts
//
// Global Zustand store with localStorage persistence.
// Caches D1 databases (and KV namespaces when implemented) so the UI
// renders immediately on startup without waiting for an API round-trip.
//
// Cache TTL: 5 minutes. After expiry the next mount re-fetches in the
// background and silently updates the cache.

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { D1Database, CloudflareAccount } from "@/hooks/useCloudflare";
import type { BucketDomainsInfo, FolderListing, R2Bucket } from "@/lib/r2";
import type { ConflictPolicy, CopyFormat, R2SortDirection, R2SortField, R2ViewMode } from "@/lib/r2AssetUtils";

export interface UserProfile {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
}

export interface PrivacySettings {
  enabled: boolean;
  accountInfo: boolean;
  databaseNames: boolean;
  databaseIds: boolean;
  tableNames: boolean;
  r2BucketNames: boolean;
  r2FileNames: boolean;
  blurAmount: number;
}

export type AppLanguage = "en-US" | "zh-CN";

// ── KV cache type ─────────────────────────────────────────────────────────────

export interface KVNamespace {
  id: string;
  title: string;
  supports_url_encoding?: boolean;
}

// ── Cache TTL ─────────────────────────────────────────────────────────────────

/** How long cached data is considered fresh (ms). Default: 10 minutes. */
export const CACHE_TTL_MS = 10 * 60 * 1_000;
export const R2_OBJECT_LISTING_CACHE_LIMIT = 200;
export const R2_BUCKET_DOMAIN_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
export const R2_BUCKET_DOMAIN_CACHE_LIMIT = 200;

export function isCacheStale(lastFetched: number | null): boolean {
  if (lastFetched === null) return true;
  return Date.now() - lastFetched > CACHE_TTL_MS;
}

export function r2ObjectListingCacheKey(accountId: string | null | undefined, bucketName: string, prefix: string): string {
  return [
    encodeURIComponent(accountId || "default"),
    encodeURIComponent(bucketName),
    encodeURIComponent(prefix),
  ].join("::");
}

export function r2BucketDomainCacheKey(accountId: string | null | undefined, bucketName: string): string {
  return [
    encodeURIComponent(accountId || "default"),
    encodeURIComponent(bucketName),
  ].join("::");
}

export interface R2ObjectListingCacheEntry {
  data: FolderListing;
  timestamp: number;
}

export interface R2BucketDomainCacheEntry {
  data: {
    publicDomain: string | null;
    domainsInfo: BucketDomainsInfo | null;
  };
  timestamp: number;
}

export type R2ImageOutputFormat = "original" | "webp" | "jpeg" | "png";

export interface R2ImageOptimizationSettings {
  enabled: boolean;
  outputFormat: R2ImageOutputFormat;
  quality: number;
  maxWidth: number | null;
  maxHeight: number | null;
  skipIfOutputLarger: boolean;
}

export interface R2UploadSettings {
  uploadPrefixInput: string;
  useDatePrefix: boolean;
  copyFormat: CopyFormat;
  copyTemplate: string;
  conflictPolicy: ConflictPolicy;
  cacheControl: string;
  transferConcurrency: number;
  retryCount: number;
  imageOptimization: R2ImageOptimizationSettings;
}

export type R2UploadSettingsPatch = Partial<Omit<R2UploadSettings, "imageOptimization">> & {
  imageOptimization?: Partial<R2ImageOptimizationSettings>;
};

export const DEFAULT_R2_UPLOAD_SETTINGS: R2UploadSettings = {
  uploadPrefixInput: "",
  useDatePrefix: false,
  copyFormat: "url",
  copyTemplate: "{url}",
  conflictPolicy: "rename",
  cacheControl: "",
  transferConcurrency: 2,
  retryCount: 1,
  imageOptimization: {
    enabled: false,
    outputFormat: "webp",
    quality: 82,
    maxWidth: 2400,
    maxHeight: null,
    skipIfOutputLarger: true,
  },
};

export function r2UploadSettingsKey(accountId: string | null | undefined, bucketName: string): string {
  return [
    encodeURIComponent(accountId || "default"),
    encodeURIComponent(bucketName),
  ].join("::");
}

export function r2PinnedBucketKey(accountId: string | null | undefined, bucketName: string): string {
  return [
    encodeURIComponent(accountId || "default"),
    encodeURIComponent(bucketName),
  ].join("::");
}

function togglePinnedKey(keys: string[], key: string): string[] {
  return keys.includes(key)
    ? keys.filter((item) => item !== key)
    : [key, ...keys];
}

// ── Store shape ───────────────────────────────────────────────────────────────

interface AppState {
  // ── Cached data ──
  userProfile: UserProfile | null;
  cloudflareAccountId: string | null;
  accounts: CloudflareAccount[];
  activeAccount: CloudflareAccount | null;
  databases: D1Database[];
  kvNamespaces: KVNamespace[];
  r2Buckets: R2Bucket[];
  r2ObjectListings: Record<string, R2ObjectListingCacheEntry>;
  r2BucketDomains: Record<string, R2BucketDomainCacheEntry>;
  r2UploadSettings: Record<string, R2UploadSettings>;
  pinnedD1DatabaseIds: string[];
  pinnedR2BucketKeys: string[];

  // ── Preferences ──
  tableDensity: "compact" | "comfortable";
  showTableColumnCounts: boolean;
  autoUpdate: boolean;
  isRefreshingSession: boolean;
  privacySettings: PrivacySettings;
  language: AppLanguage;
  saveQueryResultsEnabled: boolean;
  saveQueryResultsRowLimit: number | null;
  r2ViewMode: R2ViewMode;
  r2SortField: R2SortField;
  r2SortDirection: R2SortDirection;
  activeNavId: string;
  sidebarCollapsed: boolean;
  recentNavIds: string[];

  // ── Updater State ──
  updateStatus: "idle" | "checking" | "available" | "downloading" | "up-to-date" | "error";
  updateData: any | null;
  downloadProgress: number;
  updateError: string | null;

  /** Unix timestamp (ms) of the last successful databases fetch, or null. */
  lastFetched: number | null;

  /** Unix timestamp (ms) of the last successful KV fetch, or null. */
  kvLastFetched: number | null;

  /** Unix timestamp (ms) of the last successful R2 buckets fetch, or null. */
  r2LastFetched: number | null;

  // ── Feature Flags (Volatile, not persisted) ──
  isProBuild: boolean;
  enableD1History: boolean;
  isFlagsLoading: boolean;

  // ── Session Cache (Volatile, not persisted) ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryCache: Record<string, { data: any; timestamp: number }>;
  sessionId: string;

  // ── Actions ──
  setUserProfile: (profile: UserProfile | null) => void;
  setCloudflareAccountId: (id: string | null) => void;
  setAccounts: (accounts: CloudflareAccount[]) => void;
  setActiveAccount: (account: CloudflareAccount | null) => void;
  setTableDensity: (density: "compact" | "comfortable") => void;
  setIsRefreshingSession: (isRefreshing: boolean) => void;
  setShowTableColumnCounts: (show: boolean) => void;
  setAutoUpdate: (enabled: boolean) => void;
  setPrivacySettings: (settings: Partial<PrivacySettings>) => void;
  setLanguage: (language: AppLanguage) => void;
  setSaveQueryResultsEnabled: (enabled: boolean) => void;
  setSaveQueryResultsRowLimit: (limit: number | null) => void;
  setR2ViewMode: (mode: R2ViewMode) => void;
  setR2Sort: (field: R2SortField, direction: R2SortDirection) => void;
  setActiveNavId: (id: string) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSessionId: (id: string) => void;
  refreshSession: () => void;
  
  setUpdateStatus: (status: "idle" | "checking" | "available" | "downloading" | "up-to-date" | "error") => void;
  setUpdateData: (data: any | null) => void;
  setDownloadProgress: (progress: number) => void;
  setUpdateError: (error: string | null) => void;
  checkFeatureFlags: () => Promise<void>;

  /** Overwrite the databases list and stamp the fetch time. */
  setDatabases: (databases: D1Database[]) => void;

  /** Overwrite the KV namespaces list and stamp the fetch time. */
  setKvNamespaces: (namespaces: KVNamespace[]) => void;

  /** Overwrite the R2 buckets list and stamp the fetch time. */
  setR2Buckets: (buckets: R2Bucket[]) => void;

  /** Cache one R2 bucket/prefix object listing for stale-while-revalidate browsing. */
  setR2ObjectListing: (cacheKey: string, listing: FolderListing) => void;

  /** Cache one R2 bucket's public-domain status. */
  setR2BucketDomain: (cacheKey: string, publicDomain: string | null, domainsInfo: BucketDomainsInfo | null) => void;

  /** Persist upload defaults for one account + bucket. */
  setR2UploadSettings: (cacheKey: string, settings: R2UploadSettingsPatch) => void;

  /** Toggle one D1 database in the pinned section. */
  togglePinnedD1Database: (databaseId: string) => void;

  /** Toggle one account-scoped R2 bucket in the pinned section. */
  togglePinnedR2Bucket: (bucketKey: string) => void;

  /**
   * Wipe all cached data and timestamps.
   * Call this when the user switches Cloudflare accounts or logs out.
   */
  clearCache: () => void;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setQueryCacheItem: (key: string, data: any) => void;
  clearQueryCache: (prefix?: string) => void;
}

// ── Store implementation ──────────────────────────────────────────────────────

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // ── Initial state ──
      userProfile: null,
      cloudflareAccountId: null,
      accounts: [],
      activeAccount: null,
      databases: [],
      kvNamespaces: [],
      r2Buckets: [],
      r2ObjectListings: {},
      r2BucketDomains: {},
      r2UploadSettings: {},
      pinnedD1DatabaseIds: [],
      pinnedR2BucketKeys: [],
      tableDensity: "comfortable",
      showTableColumnCounts: true,
      autoUpdate: true,
      isRefreshingSession: false,
      privacySettings: {
        enabled: false,
        accountInfo: true,
        databaseNames: true,
        databaseIds: true,
        tableNames: true,
        r2BucketNames: true,
        r2FileNames: true,
        blurAmount: 5,
      },
      language: "en-US",
      saveQueryResultsEnabled: false,
      saveQueryResultsRowLimit: 50,
      r2ViewMode: "list",
      r2SortField: "name",
      r2SortDirection: "asc",
      activeNavId: "studio",
      sidebarCollapsed: false,
      recentNavIds: ["studio"],
      updateStatus: "idle",
      updateData: null,
      downloadProgress: 0,
      updateError: null,
      lastFetched: null,
      kvLastFetched: null,
      r2LastFetched: null,
      queryCache: {},
      sessionId: crypto.randomUUID(),

      // ── Feature Flags ──
      isProBuild: false,
      enableD1History: false,
      isFlagsLoading: true,

      // ── Actions ──
      setUserProfile: (profile) => set({ userProfile: profile }),
      setCloudflareAccountId: (id) => set({ cloudflareAccountId: id }),
      setAccounts: (accounts) => set({ accounts }),
      setActiveAccount: (account) => set({ activeAccount: account }),
      setTableDensity: (density) => set({ tableDensity: density }),
      setIsRefreshingSession: (b) => set({ isRefreshingSession: b }),
      setShowTableColumnCounts: (show) => set({ showTableColumnCounts: show }),
      setAutoUpdate: (enabled) => set({ autoUpdate: enabled }),
      setPrivacySettings: (settings) => set((s) => ({ privacySettings: { ...s.privacySettings, ...settings } })),
      setLanguage: (language) => set({ language }),
      setSaveQueryResultsEnabled: (enabled) => set({ saveQueryResultsEnabled: enabled }),
      setSaveQueryResultsRowLimit: (limit) => set({ saveQueryResultsRowLimit: limit }),
      setR2ViewMode: (r2ViewMode) => set({ r2ViewMode }),
      setR2Sort: (r2SortField, r2SortDirection) => set({ r2SortField, r2SortDirection }),
      setActiveNavId: (activeNavId) =>
        set((state) => ({
          activeNavId,
          recentNavIds: [
            activeNavId,
            ...state.recentNavIds.filter((id) => id !== activeNavId),
          ].slice(0, 8),
        })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setSessionId: (id) => set({ sessionId: id }),
      refreshSession: () => set({ sessionId: crypto.randomUUID() }),
      setUpdateStatus: (status) => set({ updateStatus: status }),
      setUpdateData: (data) => set({ updateData: data }),
      setDownloadProgress: (progress) => set({ downloadProgress: progress }),
      setUpdateError: (error) => set({ updateError: error }),
      setDatabases: (databases) =>
        set({ databases, lastFetched: Date.now() }),

      setKvNamespaces: (namespaces) =>
        set({ kvNamespaces: namespaces, kvLastFetched: Date.now() }),

      setR2Buckets: (buckets) =>
        set({ r2Buckets: buckets, r2LastFetched: Date.now() }),

      setR2ObjectListing: (cacheKey, listing) =>
        set((state) => {
          const next: Record<string, R2ObjectListingCacheEntry> = {
            ...state.r2ObjectListings,
            [cacheKey]: { data: listing, timestamp: Date.now() },
          };

          const keys = Object.keys(next);
          if (keys.length > R2_OBJECT_LISTING_CACHE_LIMIT) {
            keys
              .sort((a, b) => next[a].timestamp - next[b].timestamp)
              .slice(0, keys.length - R2_OBJECT_LISTING_CACHE_LIMIT)
              .forEach((key) => {
                delete next[key];
              });
          }

          return { r2ObjectListings: next };
        }),

      setR2BucketDomain: (cacheKey, publicDomain, domainsInfo) =>
        set((state) => {
          const next: Record<string, R2BucketDomainCacheEntry> = {
            ...state.r2BucketDomains,
            [cacheKey]: {
              data: { publicDomain, domainsInfo },
              timestamp: Date.now(),
            },
          };

          const keys = Object.keys(next);
          if (keys.length > R2_BUCKET_DOMAIN_CACHE_LIMIT) {
            keys
              .sort((a, b) => next[a].timestamp - next[b].timestamp)
              .slice(0, keys.length - R2_BUCKET_DOMAIN_CACHE_LIMIT)
              .forEach((key) => {
                delete next[key];
              });
          }

          return { r2BucketDomains: next };
        }),

      setR2UploadSettings: (cacheKey, settings) =>
        set((state) => ({
          r2UploadSettings: {
            ...state.r2UploadSettings,
            [cacheKey]: {
              ...DEFAULT_R2_UPLOAD_SETTINGS,
              ...state.r2UploadSettings[cacheKey],
              ...settings,
              imageOptimization: {
                ...DEFAULT_R2_UPLOAD_SETTINGS.imageOptimization,
                ...state.r2UploadSettings[cacheKey]?.imageOptimization,
                ...settings.imageOptimization,
              },
            },
          },
        })),

      togglePinnedD1Database: (databaseId) =>
        set((state) => ({
          pinnedD1DatabaseIds: togglePinnedKey(state.pinnedD1DatabaseIds, databaseId),
        })),

      togglePinnedR2Bucket: (bucketKey) =>
        set((state) => ({
          pinnedR2BucketKeys: togglePinnedKey(state.pinnedR2BucketKeys, bucketKey),
        })),

      clearCache: () =>
        set({
          userProfile: null,
          cloudflareAccountId: null,
          accounts: [],
          activeAccount: null,
          databases: [],
          kvNamespaces: [],
          r2Buckets: [],
          r2ObjectListings: {},
          r2BucketDomains: {},
          lastFetched: null,
          kvLastFetched: null,
          r2LastFetched: null,
          queryCache: {},
        }),

      setQueryCacheItem: (key, data) =>
        set((state) => ({
          queryCache: {
            ...state.queryCache,
            [key]: { data, timestamp: Date.now() },
          },
        })),

      clearQueryCache: (prefix) =>
        set((state) => {
          if (!prefix) return { queryCache: {} };
          const next = { ...state.queryCache };
          for (const k of Object.keys(next)) {
            if (k.startsWith(prefix)) delete next[k];
          }
          return { queryCache: next };
        }),

      checkFeatureFlags: async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        try {
          const isProBuild = await invoke<boolean>("is_pro_enabled").catch(() => false);
          const enableD1History = isProBuild;

          set({
            isProBuild,
            enableD1History,
            isFlagsLoading: false,
          });
        } catch (e) {
          set({ isProBuild: false, enableD1History: false, isFlagsLoading: false });
        }
      },
    }),
    {
      name: "cf-desk-cache",          // localStorage key
      storage: createJSONStorage(() => localStorage),
      // Only persist the data fields — actions are not serialisable.
      partialize: (state) => ({
        userProfile: state.userProfile,
        cloudflareAccountId: state.cloudflareAccountId,
        accounts: state.accounts,
        activeAccount: state.activeAccount,
        tableDensity: state.tableDensity,
        autoUpdate: state.autoUpdate,
        privacySettings: state.privacySettings,
        language: state.language,
        saveQueryResultsEnabled: state.saveQueryResultsEnabled,
        saveQueryResultsRowLimit: state.saveQueryResultsRowLimit,
        r2ViewMode: state.r2ViewMode,
        r2SortField: state.r2SortField,
        r2SortDirection: state.r2SortDirection,
        activeNavId: state.activeNavId,
        sidebarCollapsed: state.sidebarCollapsed,
        recentNavIds: state.recentNavIds,
        databases: state.databases,
        kvNamespaces: state.kvNamespaces,
        r2Buckets: state.r2Buckets,
        r2ObjectListings: state.r2ObjectListings,
        r2BucketDomains: state.r2BucketDomains,
        r2UploadSettings: state.r2UploadSettings,
        pinnedD1DatabaseIds: state.pinnedD1DatabaseIds,
        pinnedR2BucketKeys: state.pinnedR2BucketKeys,
        lastFetched: state.lastFetched,
        kvLastFetched: state.kvLastFetched,
        r2LastFetched: state.r2LastFetched,
      }),
    }
  )
);

// ── Convenience selectors (stable references, no re-render on unrelated changes) ──

export const selectDatabases   = (s: AppState) => s.databases;
export const selectLastFetched = (s: AppState) => s.lastFetched;
export const selectSetDatabases = (s: AppState) => s.setDatabases;

export const selectR2Buckets   = (s: AppState) => s.r2Buckets;
export const selectR2LastFetched = (s: AppState) => s.r2LastFetched;
export const selectSetR2Buckets = (s: AppState) => s.setR2Buckets;

export const selectClearCache  = (s: AppState) => s.clearCache;
