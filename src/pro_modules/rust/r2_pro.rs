use std::collections::HashSet;
use std::io;
use std::sync::{LazyLock, Mutex};

use futures_util::StreamExt;
use reqwest::header::{CACHE_CONTROL, CONTENT_LENGTH, CONTENT_TYPE};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio_util::codec::{BytesCodec, FramedRead};

use crate::cloudflare_auth::read_credentials;
use crate::cloudflare_client::{CfError, CfResponse, CloudflareClient};
use crate::r2::resolve_account_id;

static CANCELLED_UPLOADS: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

#[derive(Clone, serde::Serialize)]
struct R2UploadProgress {
    upload_id: String,
    bucket_name: String,
    key: String,
    bytes_sent: u64,
    total_bytes: u64,
    progress: f64,
}

fn clear_cancelled_upload(upload_id: &str) {
    if let Ok(mut cancelled) = CANCELLED_UPLOADS.lock() {
        cancelled.remove(upload_id);
    }
}

fn is_upload_cancelled(upload_id: &str) -> bool {
    CANCELLED_UPLOADS
        .lock()
        .map(|cancelled| cancelled.contains(upload_id))
        .unwrap_or(false)
}

fn emit_upload_progress(
    app: &AppHandle,
    upload_id: &str,
    bucket_name: &str,
    key: &str,
    bytes_sent: u64,
    total_bytes: u64,
) {
    let progress = if total_bytes == 0 {
        100.0
    } else {
        ((bytes_sent as f64 / total_bytes as f64) * 100.0).clamp(0.0, 100.0)
    };
    let _ = app.emit(
        "r2-upload-progress",
        R2UploadProgress {
            upload_id: upload_id.to_string(),
            bucket_name: bucket_name.to_string(),
            key: key.to_string(),
            bytes_sent,
            total_bytes,
            progress,
        },
    );
}

fn api_errors_to_string(errors: &[CfError]) -> String {
    errors
        .iter()
        .map(|e| format!("[{}] {}", e.code, e.message))
        .collect::<Vec<_>>()
        .join("; ")
}

async fn client_and_account() -> Result<(CloudflareClient, String), String> {
    let creds = tokio::task::spawn_blocking(read_credentials)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

    let client = CloudflareClient::new(&creds.oauth_token).map_err(|e| e.to_string())?;
    let account_id = match creds.account_id {
        Some(id) => id,
        None => resolve_account_id(&client)
            .await
            .map_err(|e| e.to_string())?,
    };

    Ok((client, account_id))
}

async fn parse_empty_cf_response(resp: reqwest::Response, action: &str) -> Result<(), String> {
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(format!("{action} failed with HTTP {status}: {text}"));
    }

    if text.trim().is_empty() {
        return Ok(());
    }

    let envelope: Result<CfResponse<Value>, _> = serde_json::from_str(&text);
    if let Ok(envelope) = envelope {
        if !envelope.success {
            return Err(api_errors_to_string(&envelope.errors));
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn fetch_cloudflare_zones() -> Result<Vec<Value>, String> {
    let (client, _) = client_and_account().await?;
    let resp = client
        .get("zones")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<CfResponse<Vec<Value>>>()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.success {
        return Err(api_errors_to_string(&resp.errors));
    }

    Ok(resp.result.unwrap_or_default())
}

#[tauri::command]
pub async fn create_r2_bucket(bucket_name: String) -> Result<(), String> {
    let (client, account_id) = client_and_account().await?;
    let resp = client
        .post(&format!("accounts/{account_id}/r2/buckets"))
        .json(&json!({ "name": bucket_name }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    parse_empty_cf_response(resp, "Create bucket").await
}

#[tauri::command]
pub async fn delete_r2_bucket(bucket_name: String) -> Result<(), String> {
    let (client, account_id) = client_and_account().await?;
    let resp = client
        .delete(&format!("accounts/{account_id}/r2/buckets/{bucket_name}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    parse_empty_cf_response(resp, "Delete bucket").await
}

#[tauri::command]
pub async fn empty_r2_bucket(_bucket_name: String) -> Result<(), String> {
    Err(
        "Empty bucket is not implemented yet because it needs pagination and delete confirmation."
            .to_string(),
    )
}

#[tauri::command]
pub async fn upload_r2_object(
    app: AppHandle,
    bucket_name: String,
    key: String,
    local_path: String,
    upload_id: String,
    cache_control: Option<String>,
) -> Result<(), String> {
    clear_cancelled_upload(&upload_id);
    let file = tokio::fs::File::open(&local_path)
        .await
        .map_err(|e| format!("Failed to open local file: {e}"))?;
    let total_bytes = file
        .metadata()
        .await
        .map_err(|e| format!("Failed to read local file metadata: {e}"))?
        .len();
    let content_type = mime_guess::from_path(&local_path)
        .first_or_octet_stream()
        .to_string();

    let (client, account_id) = client_and_account().await?;
    let url = format!(
        "accounts/{account_id}/r2/buckets/{bucket_name}/objects/{}",
        urlencoding::encode(&key)
    );

    emit_upload_progress(&app, &upload_id, &bucket_name, &key, 0, total_bytes);

    let stream_app = app.clone();
    let stream_upload_id = upload_id.clone();
    let stream_bucket_name = bucket_name.clone();
    let stream_key = key.clone();
    let mut bytes_sent = 0u64;
    let stream = FramedRead::new(file, BytesCodec::new()).map(move |chunk| {
        let chunk = chunk?;
        if is_upload_cancelled(&stream_upload_id) {
            return Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "Upload canceled.",
            ));
        }
        bytes_sent += chunk.len() as u64;
        emit_upload_progress(
            &stream_app,
            &stream_upload_id,
            &stream_bucket_name,
            &stream_key,
            bytes_sent,
            total_bytes,
        );
        Ok::<_, io::Error>(chunk.freeze())
    });

    let mut request = client
        .put(&url)
        .header(CONTENT_TYPE, content_type)
        .header(CONTENT_LENGTH, total_bytes)
        .body(reqwest::Body::wrap_stream(stream));

    if let Some(cache_control) = cache_control.filter(|value| !value.trim().is_empty()) {
        request = request.header(CACHE_CONTROL, cache_control);
    }

    let resp = request.send().await.map_err(|e| {
        if is_upload_cancelled(&upload_id) {
            clear_cancelled_upload(&upload_id);
            "Upload canceled.".to_string()
        } else {
            e.to_string()
        }
    })?;

    if is_upload_cancelled(&upload_id) {
        clear_cancelled_upload(&upload_id);
        return Err("Upload canceled.".to_string());
    }

    let result = parse_empty_cf_response(resp, "Upload object").await;
    if result.is_ok() {
        emit_upload_progress(
            &app,
            &upload_id,
            &bucket_name,
            &key,
            total_bytes,
            total_bytes,
        );
    }
    clear_cancelled_upload(&upload_id);
    result
}

#[tauri::command]
pub async fn upload_r2_object_bytes(
    bucket_name: String,
    key: String,
    bytes: Vec<u8>,
    content_type: Option<String>,
    cache_control: Option<String>,
) -> Result<(), String> {
    let (client, account_id) = client_and_account().await?;
    let url = format!(
        "accounts/{account_id}/r2/buckets/{bucket_name}/objects/{}",
        urlencoding::encode(&key)
    );
    let content_type = content_type.unwrap_or_else(|| {
        mime_guess::from_path(&key)
            .first_or_octet_stream()
            .to_string()
    });

    let mut request = client
        .put(&url)
        .header(CONTENT_TYPE, content_type)
        .body(bytes);

    if let Some(cache_control) = cache_control.filter(|value| !value.trim().is_empty()) {
        request = request.header(CACHE_CONTROL, cache_control);
    }

    let resp = request.send().await.map_err(|e| e.to_string())?;

    parse_empty_cf_response(resp, "Upload object").await
}

#[tauri::command]
pub async fn upload_r2_remote_url(
    bucket_name: String,
    key: String,
    source_url: String,
    cache_control: Option<String>,
) -> Result<(), String> {
    let url = reqwest::Url::parse(&source_url).map_err(|e| format!("Invalid URL: {e}"))?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("Only http and https URLs can be uploaded.".to_string());
    }

    let resp = reqwest::Client::new()
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to download remote file: {e}"))?;
    let status = resp.status();
    let content_type = resp
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned);
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read remote file: {e}"))?;

    if !status.is_success() {
        let text = String::from_utf8_lossy(&bytes);
        return Err(format!("Remote download failed with HTTP {status}: {text}"));
    }

    upload_r2_object_bytes(
        bucket_name,
        key,
        bytes.to_vec(),
        content_type,
        cache_control,
    )
    .await
}

#[tauri::command]
pub async fn cancel_upload_r2_object(
    upload_id: String,
    _bucket_name: String,
    _key: String,
) -> Result<(), String> {
    if let Ok(mut cancelled) = CANCELLED_UPLOADS.lock() {
        cancelled.insert(upload_id);
    }
    Ok(())
}

#[tauri::command]
pub async fn download_r2_object(
    bucket_name: String,
    key: String,
    destination_path: String,
) -> Result<(), String> {
    let (client, account_id) = client_and_account().await?;
    let url = format!(
        "accounts/{account_id}/r2/buckets/{bucket_name}/objects/{}",
        urlencoding::encode(&key)
    );

    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to download object: {e}"))?;

    if !status.is_success() {
        let text = String::from_utf8_lossy(&bytes);
        return Err(format!("Download failed with HTTP {status}: {text}"));
    }

    if let Some(parent) = std::path::Path::new(&destination_path).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create destination directory: {e}"))?;
    }

    tokio::fs::write(&destination_path, bytes)
        .await
        .map_err(|e| format!("Failed to write destination file: {e}"))?;

    Ok(())
}

async fn read_r2_object_for_copy(
    client: &CloudflareClient,
    account_id: &str,
    bucket_name: &str,
    key: &str,
) -> Result<(Vec<u8>, Option<String>, Option<String>), String> {
    let url = format!(
        "accounts/{account_id}/r2/buckets/{bucket_name}/objects/{}",
        urlencoding::encode(key)
    );

    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let content_type = resp
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned);
    let cache_control = resp
        .headers()
        .get(CACHE_CONTROL)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned);
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read source object: {e}"))?;

    if !status.is_success() {
        let text = String::from_utf8_lossy(&bytes);
        return Err(format!(
            "Read source object failed with HTTP {status}: {text}"
        ));
    }

    Ok((bytes.to_vec(), content_type, cache_control))
}

#[tauri::command]
pub async fn copy_r2_object(
    bucket_name: String,
    source_key: String,
    destination_key: String,
) -> Result<(), String> {
    let destination_key = destination_key.trim().trim_start_matches('/').to_string();
    if source_key.trim().is_empty() || destination_key.is_empty() {
        return Err("Source and destination object keys are required.".to_string());
    }
    if source_key == destination_key {
        return Err("Destination key must be different from the source key.".to_string());
    }

    let (client, account_id) = client_and_account().await?;
    let (bytes, content_type, cache_control) =
        read_r2_object_for_copy(&client, &account_id, &bucket_name, &source_key).await?;

    upload_r2_object_bytes(
        bucket_name,
        destination_key,
        bytes,
        content_type,
        cache_control,
    )
    .await
}

#[tauri::command]
pub async fn move_r2_object(
    bucket_name: String,
    source_key: String,
    destination_key: String,
) -> Result<(), String> {
    let destination_key = destination_key.trim().trim_start_matches('/').to_string();
    copy_r2_object(bucket_name.clone(), source_key.clone(), destination_key).await?;

    crate::r2::delete_r2_object(bucket_name, source_key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_r2_bucket_managed_domain(
    bucket_name: String,
    enabled: bool,
) -> Result<(), String> {
    let (client, account_id) = client_and_account().await?;
    let resp = client
        .put(&format!(
            "accounts/{account_id}/r2/buckets/{bucket_name}/domains/managed"
        ))
        .json(&json!({ "enabled": enabled }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    parse_empty_cf_response(resp, "Update managed domain").await
}

#[tauri::command]
pub async fn add_r2_bucket_custom_domain(
    bucket_name: String,
    domain: String,
    zone_id: String,
    zone_name: String,
) -> Result<(), String> {
    let (client, account_id) = client_and_account().await?;
    let resp = client
        .post(&format!(
            "accounts/{account_id}/r2/buckets/{bucket_name}/domains/custom"
        ))
        .json(&json!({
            "domain": domain,
            "enabled": true,
            "zoneId": zone_id,
            "zoneName": zone_name,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    parse_empty_cf_response(resp, "Attach custom domain").await
}

#[tauri::command]
pub async fn remove_r2_bucket_custom_domain(
    bucket_name: String,
    domain: String,
) -> Result<(), String> {
    let (client, account_id) = client_and_account().await?;
    let resp = client
        .delete(&format!(
            "accounts/{account_id}/r2/buckets/{bucket_name}/domains/custom/{}",
            urlencoding::encode(&domain)
        ))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    parse_empty_cf_response(resp, "Remove custom domain").await
}

#[tauri::command]
pub async fn get_r2_bucket_domains_list(bucket_name: String) -> Result<Value, String> {
    let (client, account_id) = client_and_account().await?;
    let managed_resp = client
        .get(&format!(
            "accounts/{account_id}/r2/buckets/{bucket_name}/domains/managed"
        ))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<CfResponse<Value>>()
        .await
        .map_err(|e| e.to_string())?;

    let custom_resp = client
        .get(&format!(
            "accounts/{account_id}/r2/buckets/{bucket_name}/domains/custom"
        ))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<CfResponse<Value>>()
        .await
        .map_err(|e| e.to_string())?;

    let managed = if managed_resp.success {
        managed_resp.result.unwrap_or(Value::Null)
    } else {
        json!({ "error": api_errors_to_string(&managed_resp.errors) })
    };

    let custom = if custom_resp.success {
        custom_resp
            .result
            .and_then(|value| value.get("domains").cloned())
            .unwrap_or_else(|| json!([]))
    } else {
        json!({ "error": api_errors_to_string(&custom_resp.errors) })
    };

    Ok(json!({ "managed": managed, "custom": custom }))
}
