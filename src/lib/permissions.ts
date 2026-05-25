import { invokeCloudflare } from "@/hooks/useCloudflare";

export type PermissionStatus = "ok" | "blocked" | "unknown" | "warning";

export interface PermissionCheck {
  product: string;
  action: "read" | "write";
  status: PermissionStatus;
  endpoint: string;
  message: string;
  missing_permissions: string[];
}

export async function checkCloudflarePermissions(): Promise<PermissionCheck[]> {
  return invokeCloudflare<PermissionCheck[]>("check_cloudflare_permissions");
}
