import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function orderPinnedFirst<T>(
  items: T[],
  pinnedKeys: string[],
  getKey: (item: T) => string
): T[] {
  if (items.length === 0 || pinnedKeys.length === 0) return items;

  const pinnedRank = new Map(pinnedKeys.map((key, index) => [key, index]));

  return items
    .map((item, index) => ({ item, index, rank: pinnedRank.get(getKey(item)) }))
    .sort((a, b) => {
      const aPinned = a.rank !== undefined;
      const bPinned = b.rank !== undefined;

      if (aPinned && bPinned) return a.rank! - b.rank!;
      if (aPinned) return -1;
      if (bPinned) return 1;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

export function formatBytes(bytes?: number): string {
  if (bytes === undefined) return "—";
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
