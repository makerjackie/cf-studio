export type StudioHealthTone = "good" | "warning" | "danger" | "muted";

export interface CacheFreshness {
  status: "fresh" | "stale" | "empty";
  label: string;
  ageMs: number | null;
}
export interface StudioCommandLike {
  id: string;
  title: string;
  subtitle?: string;
  keywords?: string[];
}

export interface ReleaseReadinessCheck {
  id: string;
  passed: boolean;
}

export const MINIMUM_TOKEN_PERMISSIONS = [
  "Account:Read",
  "D1:Read",
  "D1:Edit",
  "R2 Storage:Read",
  "R2 Storage:Edit",
  "Workers KV Storage:Read",
  "Workers KV Storage:Edit",
  "Workers Scripts:Read",
  "Workers Scripts:Edit",
  "Queues:Read",
  "Queues:Edit",
  "Account Analytics:Read",
];

export function formatRelativeAge(timestamp: number | null | undefined, now = Date.now()): string {
  if (!timestamp) return "never";

  const diffMs = Math.max(0, now - timestamp);
  const seconds = Math.floor(diffMs / 1_000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function getCacheFreshness(
  lastFetched: number | null | undefined,
  ttlMs: number,
  now = Date.now()
): CacheFreshness {
  if (!lastFetched) {
    return { status: "empty", label: "not loaded", ageMs: null };
  }

  const ageMs = Math.max(0, now - lastFetched);
  return {
    status: ageMs > ttlMs ? "stale" : "fresh",
    label: formatRelativeAge(lastFetched, now),
    ageMs,
  };
}

export function buildAccountDashboardUrl(accountId: string | null | undefined): string {
  return accountId
    ? `https://dash.cloudflare.com/${accountId}`
    : "https://dash.cloudflare.com";
}

export function buildWranglerEnvSnippet(accountId: string | null | undefined): string {
  const lines = [
    'export CLOUDFLARE_API_TOKEN="your-token"',
  ];

  if (accountId) {
    lines.push(`export CLOUDFLARE_ACCOUNT_ID="${accountId}"`);
  } else {
    lines.push('export CLOUDFLARE_ACCOUNT_ID="your-account-id"');
  }

  return lines.join("\n");
}

export function buildTokenPermissionText(): string {
  return MINIMUM_TOKEN_PERMISSIONS.join("\n");
}

export function filterStudioCommands<T extends StudioCommandLike>(commands: T[], query: string): T[] {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (terms.length === 0) return commands;

  return commands.filter((command) => {
    const haystack = [
      command.title,
      command.subtitle ?? "",
      ...(command.keywords ?? []),
    ].join(" ").toLowerCase();

    return terms.every((term) => haystack.includes(term));
  });
}

export function calculateReleaseReadiness(checks: ReleaseReadinessCheck[]): number {
  if (checks.length === 0) return 0;
  const passed = checks.filter((check) => check.passed).length;
  return Math.round((passed / checks.length) * 100);
}
