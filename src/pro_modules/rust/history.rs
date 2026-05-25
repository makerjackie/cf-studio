use serde_json::Value;

fn unavailable() -> String {
    "Query history is not included in this public fork yet.".to_string()
}

#[tauri::command]
pub async fn save_query_history() -> Result<Value, String> {
    Err(unavailable())
}

#[tauri::command]
pub async fn get_paginated_history() -> Result<Value, String> {
    Err(unavailable())
}

#[tauri::command]
pub async fn get_global_stats() -> Result<Value, String> {
    Err(unavailable())
}

#[tauri::command]
pub async fn clear_query_history() -> Result<(), String> {
    Err(unavailable())
}

#[tauri::command]
pub async fn get_history_debug_status() -> Result<Value, String> {
    Err(unavailable())
}
