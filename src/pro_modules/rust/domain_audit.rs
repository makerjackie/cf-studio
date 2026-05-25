use serde_json::Value;

fn unavailable() -> String {
    "Domain audit is not included in this public fork yet.".to_string()
}

#[tauri::command]
pub async fn list_cf_zones() -> Result<Value, String> { Err(unavailable()) }

#[tauri::command]
pub async fn get_zone_security_settings() -> Result<Value, String> { Err(unavailable()) }

#[tauri::command]
pub async fn update_zone_setting() -> Result<Value, String> { Err(unavailable()) }

#[tauri::command]
pub async fn validate_zone_token() -> Result<Value, String> { Err(unavailable()) }

#[tauri::command]
pub async fn verify_global_token() -> Result<Value, String> { Err(unavailable()) }

#[tauri::command]
pub async fn save_zone_token() -> Result<(), String> { Err(unavailable()) }

#[tauri::command]
pub async fn delete_zone_token() -> Result<(), String> { Ok(()) }

#[tauri::command]
pub async fn has_zone_token() -> Result<bool, String> { Ok(false) }

#[tauri::command]
pub async fn get_zone_performance_settings() -> Result<Value, String> { Err(unavailable()) }

#[tauri::command]
pub async fn get_zone_dns_health() -> Result<Value, String> { Err(unavailable()) }

#[tauri::command]
pub async fn add_dns_record() -> Result<Value, String> { Err(unavailable()) }

#[tauri::command]
pub async fn check_active_token() -> Result<Value, String> { Err(unavailable()) }

#[tauri::command]
pub async fn analyze_domain() -> Result<Value, String> { Err(unavailable()) }
