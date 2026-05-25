use serde_json::{json, Value};

fn unavailable() -> String {
    "This R2 action is not included in this public fork yet.".to_string()
}

#[tauri::command]
pub async fn fetch_cloudflare_zones() -> Result<Vec<Value>, String> {
    Ok(Vec::new())
}

#[tauri::command]
pub async fn create_r2_bucket(_bucket_name: String) -> Result<(), String> {
    Err(unavailable())
}

#[tauri::command]
pub async fn delete_r2_bucket(_bucket_name: String) -> Result<(), String> {
    Err(unavailable())
}

#[tauri::command]
pub async fn empty_r2_bucket(_bucket_name: String) -> Result<(), String> {
    Err(unavailable())
}

#[tauri::command]
pub async fn upload_r2_object(
    _bucket_name: String,
    _key: String,
    _local_path: String,
    _upload_id: String,
) -> Result<(), String> {
    Err(unavailable())
}

#[tauri::command]
pub async fn cancel_upload_r2_object(
    _upload_id: String,
    _bucket_name: String,
    _key: String,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn download_r2_object(
    _bucket_name: String,
    _key: String,
    _destination_path: String,
) -> Result<(), String> {
    Err(unavailable())
}

#[tauri::command]
pub async fn update_r2_bucket_managed_domain(
    _bucket_name: String,
    _enabled: bool,
) -> Result<(), String> {
    Err(unavailable())
}

#[tauri::command]
pub async fn add_r2_bucket_custom_domain(
    _bucket_name: String,
    _domain: String,
    _zone_id: String,
    _zone_name: String,
) -> Result<(), String> {
    Err(unavailable())
}

#[tauri::command]
pub async fn remove_r2_bucket_custom_domain(
    _bucket_name: String,
    _domain: String,
) -> Result<(), String> {
    Err(unavailable())
}

#[tauri::command]
pub async fn get_r2_bucket_domains_list(_bucket_name: String) -> Result<Value, String> {
    Ok(json!({ "managed": null, "custom": [] }))
}
