import type { D1TableSchema } from "@/hooks/useCloudflare";

export function IndexManagerDialog({
  open,
  onOpenChange,
}: {
  databaseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allTables: D1TableSchema[];
}) {
  if (open) {
    queueMicrotask(() => onOpenChange(false));
  }
  return null;
}
