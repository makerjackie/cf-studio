export interface RemoteConfig {
  is_export_free?: boolean;
  current_version?: string;
  enable_audits?: boolean;
  max_r2_upload_size?: number;
  enable_r2_bucket_settings?: boolean;
  enable_r2_upload?: boolean;
  enable_r2_bucket_mgmt?: boolean;
  enable_d1_index_management?: boolean;
  enable_d1_query_history?: boolean;
}

const PUBLIC_FALLBACK_CONFIG: RemoteConfig = {
  is_export_free: false,
  enable_audits: false,
  enable_r2_bucket_settings: false,
  enable_r2_upload: false,
  enable_r2_bucket_mgmt: false,
  enable_d1_index_management: false,
  enable_d1_query_history: false,
};

export function useRemoteConfig() {
  return {
    data: PUBLIC_FALLBACK_CONFIG,
    isLoading: false,
    error: null,
  };
}
