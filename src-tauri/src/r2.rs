// r2.rs
//
// Cloudflare R2 — PUBLIC tier commands only.
// Pro commands (upload, download, create/delete bucket, settings) live in r2_pro.rs
// and are only compiled when the `pro` Cargo feature is enabled.
//
// Public commands: fetch_r2_buckets, list_r2_objects, delete_r2_object, get_r2_bucket_domain

use serde::{Deserialize, Serialize};
use std::{io::Cursor, time::SystemTime};
use tauri::Manager;

use crate::cloudflare_auth::{read_credentials, AuthError};
use crate::cloudflare_client::{CfError, CfResponse, CloudflareClient};

// ── Error type ─────────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum R2Error {
    #[error("Authentication error: {0}")]
    Auth(#[from] AuthError),

    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error(
        "Could not determine your Cloudflare account ID. Your account may not have API access."
    )]
    NoAccountId,

    #[error("Cloudflare API error(s): {0}")]
    Api(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),

    #[error("Image error: {0}")]
    Image(String),
}

impl Serialize for R2Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

// ── API types ──────────────────────────────────────────────────────────────────

/// Minimal account info from `GET /accounts`.
#[derive(Debug, Deserialize)]
struct CfAccount {
    id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct R2Bucket {
    pub name: String,
    pub creation_date: String,
    pub object_count: Option<u64>,
    pub total_size_bytes: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BucketsResponse {
    pub buckets: Vec<R2Bucket>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct R2Object {
    pub key: String,
    pub size: u64,
    pub uploaded: String,
    pub etag: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ObjectsResponse {
    pub objects: Option<Vec<serde_json::Value>>,
    #[serde(rename = "delimitedPrefixes")]
    pub delimited_prefixes: Option<Vec<serde_json::Value>>,
    pub truncated: bool,
    pub cursor: Option<String>,
}

#[derive(Serialize)]
pub struct FolderListing {
    pub files: Vec<R2Object>,
    pub folders: Vec<String>,
}

const R2_THUMBNAIL_CACHE_MAX_BYTES: u64 = 300 * 1024 * 1024;
const R2_THUMBNAIL_MAX_SOURCE_BYTES: u64 = 12 * 1024 * 1024;
const R2_THUMBNAIL_MAX_DIMENSION: u32 = 320;
const R2_PREVIEW_MAX_SOURCE_BYTES: u64 = 50 * 1024 * 1024;

// ── Helper ─────────────────────────────────────────────────────────────────────

fn api_errors_to_string(errors: &[CfError]) -> String {
    errors
        .iter()
        .map(|e| format!("[{}] {}", e.code, e.message))
        .collect::<Vec<_>>()
        .join("; ")
}

fn thumbnail_extension(url: &str, content_type: Option<&str>) -> &'static str {
    if let Some(content_type) = content_type {
        if content_type.contains("image/jpeg") {
            return "jpg";
        }
        if content_type.contains("image/png") {
            return "png";
        }
        if content_type.contains("image/webp") {
            return "webp";
        }
        if content_type.contains("image/gif") {
            return "gif";
        }
        if content_type.contains("image/avif") {
            return "avif";
        }
        if content_type.contains("image/svg") {
            return "svg";
        }
    }

    let lower = url.to_ascii_lowercase();
    if lower.contains(".jpg") || lower.contains(".jpeg") {
        "jpg"
    } else if lower.contains(".webp") {
        "webp"
    } else if lower.contains(".gif") {
        "gif"
    } else if lower.contains(".avif") {
        "avif"
    } else if lower.contains(".svg") {
        "svg"
    } else {
        "png"
    }
}

fn is_image_like(source: &str, content_type: Option<&str>) -> bool {
    if content_type
        .map(|value| value.to_ascii_lowercase().starts_with("image/"))
        .unwrap_or(false)
    {
        return true;
    }

    let lower = source.to_ascii_lowercase();
    lower.ends_with(".avif")
        || lower.ends_with(".gif")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".png")
        || lower.ends_with(".svg")
        || lower.ends_with(".webp")
}

fn evict_thumbnail_cache(cache_dir: &std::path::Path) -> Result<(), R2Error> {
    let entries = match std::fs::read_dir(cache_dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(R2Error::Io(err)),
    };

    let mut files = Vec::new();
    let mut total_size = 0_u64;

    for entry in entries {
        let entry = entry?;
        let metadata = entry.metadata()?;
        if !metadata.is_file() {
            continue;
        }

        let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        let size = metadata.len();
        total_size = total_size.saturating_add(size);
        files.push((entry.path(), size, modified));
    }

    if total_size <= R2_THUMBNAIL_CACHE_MAX_BYTES {
        return Ok(());
    }

    files.sort_by_key(|(_, _, modified)| *modified);
    for (path, size, _) in files {
        if total_size <= R2_THUMBNAIL_CACHE_MAX_BYTES {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total_size = total_size.saturating_sub(size);
        }
    }

    Ok(())
}

fn thumbnail_bytes(
    bytes: &[u8],
    content_type: Option<&str>,
    source_url: &str,
) -> Result<(Vec<u8>, &'static str), R2Error> {
    let content_type = content_type.unwrap_or_default().to_ascii_lowercase();
    if content_type.contains("image/svg") || source_url.to_ascii_lowercase().contains(".svg") {
        return Ok((bytes.to_vec(), "svg"));
    }

    let image = match image::load_from_memory(bytes) {
        Ok(image) => image,
        Err(_) => {
            return Ok((
                bytes.to_vec(),
                thumbnail_extension(source_url, Some(&content_type)),
            ))
        }
    };

    let thumbnail = image.thumbnail(R2_THUMBNAIL_MAX_DIMENSION, R2_THUMBNAIL_MAX_DIMENSION);
    let mut output = Cursor::new(Vec::new());
    thumbnail
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(|err| R2Error::Image(err.to_string()))?;

    Ok((output.into_inner(), "png"))
}

pub(crate) async fn resolve_account_id(client: &CloudflareClient) -> Result<String, R2Error> {
    let resp = client
        .get("accounts")
        .send()
        .await?
        .json::<CfResponse<Vec<CfAccount>>>()
        .await?;

    if !resp.success {
        return Err(R2Error::Api(api_errors_to_string(&resp.errors)));
    }

    let accounts = resp.result.unwrap_or_default();
    accounts
        .into_iter()
        .next()
        .map(|a| a.id)
        .ok_or(R2Error::NoAccountId)
}

// ── Public Tauri Commands ──────────────────────────────────────────────────────

/// Fetches the list of all R2 buckets for the authenticated Cloudflare account.
#[tauri::command]
pub async fn fetch_r2_buckets() -> Result<Vec<R2Bucket>, R2Error> {
    let creds = tokio::task::spawn_blocking(read_credentials)
        .await
        .map_err(|e| {
            R2Error::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                e.to_string(),
            ))
        })??;

    let client = CloudflareClient::new(&creds.oauth_token)?;
    let account_id = match creds.account_id {
        Some(id) => id,
        None => resolve_account_id(&client).await?,
    };

    let resp = client
        .get(&format!("accounts/{}/r2/buckets", account_id))
        .send()
        .await?
        .json::<CfResponse<BucketsResponse>>()
        .await?;

    if !resp.success {
        return Err(R2Error::Api(api_errors_to_string(&resp.errors)));
    }

    let mut buckets = resp.result.map(|r| r.buckets).unwrap_or_default();

    // ── GraphQL Stats Fetching ───────────────────────────────────────────────
    let date_geq = chrono::Utc::now()
        .checked_sub_days(chrono::Days::new(2))
        .unwrap_or_else(chrono::Utc::now)
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string();

    let query = format!(
        r#"query {{ viewer {{ accounts(filter: {{accountTag: "{account_id}"}}) {{ r2StorageAdaptiveGroups(limit: 1000, filter: {{datetime_geq: "{date_geq}"}}) {{ dimensions {{ bucketName }} max {{ objectCount payloadSize }} }} }} }} }}"#
    );

    let gql_resp = client
        .post("graphql")
        .json(&serde_json::json!({ "query": query }))
        .send()
        .await;

    if let Ok(gql_res) = gql_resp {
        if let Ok(data) = gql_res.json::<serde_json::Value>().await {
            if let Some(groups) =
                data["data"]["viewer"]["accounts"][0]["r2StorageAdaptiveGroups"].as_array()
            {
                let mut stats_map = std::collections::HashMap::new();
                for group in groups {
                    if let Some(bname) = group["dimensions"]["bucketName"].as_str() {
                        let count = group["max"]["objectCount"].as_u64().unwrap_or(0);
                        let size = group["max"]["payloadSize"].as_u64().unwrap_or(0);
                        stats_map.insert(bname.to_string(), (count, size));
                    }
                }

                for b in &mut buckets {
                    if let Some(&(count, size)) = stats_map.get(&b.name) {
                        b.object_count = Some(count);
                        b.total_size_bytes = Some(size);
                    } else {
                        b.object_count = Some(0);
                        b.total_size_bytes = Some(0);
                    }
                }
            }
        }
    }

    Ok(buckets)
}

/// Lists objects (files) and common prefixes (folders) at a specific prefix.
#[tauri::command]
pub async fn list_r2_objects(
    bucket_name: String,
    prefix: String,
) -> Result<FolderListing, R2Error> {
    let creds = tokio::task::spawn_blocking(read_credentials)
        .await
        .map_err(|e| {
            R2Error::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                e.to_string(),
            ))
        })??;

    let client = CloudflareClient::new(&creds.oauth_token)?;
    let account_id = match creds.account_id {
        Some(id) => id,
        None => resolve_account_id(&client).await?,
    };

    let mut url = format!(
        "accounts/{}/r2/buckets/{}/objects?delimiter=/",
        account_id, bucket_name
    );
    if !prefix.is_empty() {
        url = format!("{}&prefix={}", url, urlencoding::encode(&prefix));
    }

    let resp = client
        .get(&url)
        .send()
        .await?
        .json::<CfResponse<Vec<serde_json::Value>>>()
        .await?;

    if !resp.success {
        return Err(R2Error::Api(api_errors_to_string(&resp.errors)));
    }

    let all_objects = resp.result.unwrap_or_default();

    let mut files = Vec::new();
    let mut folders = std::collections::HashSet::new();

    // Cloudflare's REST API returns a flat array. We simulate folder architecture manually:
    for obj in all_objects {
        let key = obj["key"].as_str().unwrap_or("").to_string();

        if !prefix.is_empty() && !key.starts_with(&prefix) {
            continue;
        }

        let relative_path = if prefix.is_empty() {
            &key[..]
        } else {
            &key[prefix.len()..]
        };

        if let Some(slash_idx) = relative_path.find('/') {
            let folder_name = &relative_path[..=slash_idx];
            folders.insert(format!("{}{}", prefix, folder_name));
        } else {
            files.push(R2Object {
                key,
                size: obj["size"].as_u64().unwrap_or(0),
                uploaded: obj["last_modified"]
                    .as_str()
                    .unwrap_or(obj["uploaded"].as_str().unwrap_or(""))
                    .to_string(),
                etag: obj["etag"].as_str().unwrap_or("").to_string(),
            });
        }
    }

    if let Some(info) = resp.result_info {
        if let Some(delimited) = info.get("delimited").and_then(|v| v.as_array()) {
            for v in delimited {
                if let Some(s) = v.as_str() {
                    folders.insert(s.to_string());
                }
            }
        }
    }

    let mut folders_vec: Vec<String> = folders.into_iter().collect();
    folders_vec.sort();

    Ok(FolderListing {
        files,
        folders: folders_vec,
    })
}

/// Caches a publicly accessible R2 image in the local app cache directory.
/// The frontend passes a cache key containing account, bucket, object key and
/// etag, so changed objects automatically create a new thumbnail cache file.
#[tauri::command]
pub async fn cache_r2_public_thumbnail(
    app: tauri::AppHandle,
    url: String,
    cache_key: String,
) -> Result<String, R2Error> {
    let parsed = reqwest::Url::parse(&url)
        .map_err(|_| R2Error::InvalidInput("Thumbnail URL is not valid.".to_string()))?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err(R2Error::InvalidInput(
            "Thumbnail URL must use http or https.".to_string(),
        ));
    }

    let hash = format!("{:x}", md5::compute(cache_key.as_bytes()));
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| R2Error::InvalidInput(e.to_string()))?
        .join("r2-thumbnails");

    tokio::fs::create_dir_all(&cache_dir).await?;

    for ext in ["jpg", "png", "webp", "gif", "avif", "svg"] {
        let existing = cache_dir.join(format!("{hash}.{ext}"));
        if existing.exists() {
            return Ok(existing.to_string_lossy().to_string());
        }
    }

    let resp = reqwest::Client::new().get(parsed).send().await?;
    let status = resp.status();
    if !status.is_success() {
        return Err(R2Error::Api(format!(
            "Thumbnail request failed with HTTP {status}"
        )));
    }

    if let Some(content_length) = resp.content_length() {
        if content_length > R2_THUMBNAIL_MAX_SOURCE_BYTES {
            return Err(R2Error::InvalidInput(
                "Image is too large for thumbnail cache.".to_string(),
            ));
        }
    }

    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());

    if let Some(content_type) = content_type.as_deref() {
        if !content_type.starts_with("image/") {
            return Err(R2Error::InvalidInput(
                "Thumbnail URL did not return an image.".to_string(),
            ));
        }
    }

    let bytes = resp.bytes().await?;
    if bytes.len() as u64 > R2_THUMBNAIL_MAX_SOURCE_BYTES {
        return Err(R2Error::InvalidInput(
            "Image is too large for thumbnail cache.".to_string(),
        ));
    }

    let (thumbnail, ext) = thumbnail_bytes(&bytes, content_type.as_deref(), &url)?;
    let dest = cache_dir.join(format!("{hash}.{ext}"));
    tokio::fs::write(&dest, &thumbnail).await?;

    let cache_dir_for_evict = cache_dir.clone();
    tokio::task::spawn_blocking(move || evict_thumbnail_cache(&cache_dir_for_evict))
        .await
        .map_err(|e| {
            R2Error::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                e.to_string(),
            ))
        })??;

    Ok(dest.to_string_lossy().to_string())
}

/// Downloads an authenticated R2 image object into the local app cache and
/// stores a downsized preview. This lets private buckets be browsed visually
/// without enabling a public r2.dev or custom-domain URL.
#[tauri::command]
pub async fn cache_r2_object_preview(
    app: tauri::AppHandle,
    bucket_name: String,
    key: String,
    cache_key: String,
    max_dimension: u32,
) -> Result<String, R2Error> {
    let max_dimension = max_dimension.clamp(160, 2_400);
    let hash = format!("{:x}", md5::compute(cache_key.as_bytes()));
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| R2Error::InvalidInput(e.to_string()))?
        .join("r2-object-previews");

    tokio::fs::create_dir_all(&cache_dir).await?;

    for ext in ["jpg", "png", "webp", "gif", "avif", "svg"] {
        let existing = cache_dir.join(format!("{hash}.{ext}"));
        if existing.exists() {
            return Ok(existing.to_string_lossy().to_string());
        }
    }

    let creds = tokio::task::spawn_blocking(read_credentials)
        .await
        .map_err(|e| {
            R2Error::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                e.to_string(),
            ))
        })??;

    let client = CloudflareClient::new(&creds.oauth_token)?;
    let account_id = match creds.account_id {
        Some(id) => id,
        None => resolve_account_id(&client).await?,
    };

    let url = format!(
        "accounts/{}/r2/buckets/{}/objects/{}",
        account_id,
        bucket_name,
        urlencoding::encode(&key)
    );

    let resp = client.get(&url).send().await?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(R2Error::Api(format!(
            "Preview request failed with HTTP {status}: {text}"
        )));
    }

    if let Some(content_length) = resp.content_length() {
        if content_length > R2_PREVIEW_MAX_SOURCE_BYTES {
            return Err(R2Error::InvalidInput(
                "Image is too large for local preview.".to_string(),
            ));
        }
    }

    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());

    if !is_image_like(&key, content_type.as_deref()) {
        return Err(R2Error::InvalidInput(
            "R2 object is not an image preview target.".to_string(),
        ));
    }

    let bytes = resp.bytes().await?;
    if bytes.len() as u64 > R2_PREVIEW_MAX_SOURCE_BYTES {
        return Err(R2Error::InvalidInput(
            "Image is too large for local preview.".to_string(),
        ));
    }

    let (preview, ext) = if content_type
        .as_deref()
        .map(|value| value.contains("image/svg"))
        .unwrap_or(false)
        || key.to_ascii_lowercase().ends_with(".svg")
    {
        (bytes.to_vec(), "svg")
    } else {
        match image::load_from_memory(&bytes) {
            Ok(image) => {
                let preview = image.thumbnail(max_dimension, max_dimension);
                let mut output = Cursor::new(Vec::new());
                preview
                    .write_to(&mut output, image::ImageFormat::Png)
                    .map_err(|err| R2Error::Image(err.to_string()))?;
                (output.into_inner(), "png")
            }
            Err(_) => (
                bytes.to_vec(),
                thumbnail_extension(&key, content_type.as_deref()),
            ),
        }
    };

    let dest = cache_dir.join(format!("{hash}.{ext}"));
    tokio::fs::write(&dest, &preview).await?;

    let cache_dir_for_evict = cache_dir.clone();
    tokio::task::spawn_blocking(move || evict_thumbnail_cache(&cache_dir_for_evict))
        .await
        .map_err(|e| {
            R2Error::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                e.to_string(),
            ))
        })??;

    Ok(dest.to_string_lossy().to_string())
}

/// Deletes an object by key.
#[tauri::command]
pub async fn delete_r2_object(bucket_name: String, key: String) -> Result<(), R2Error> {
    let creds = tokio::task::spawn_blocking(read_credentials)
        .await
        .map_err(|e| {
            R2Error::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                e.to_string(),
            ))
        })??;

    let client = CloudflareClient::new(&creds.oauth_token)?;
    let account_id = match creds.account_id {
        Some(id) => id,
        None => resolve_account_id(&client).await?,
    };

    let url = format!(
        "accounts/{}/r2/buckets/{}/objects/{}",
        account_id,
        bucket_name,
        urlencoding::encode(&key)
    );

    let resp = client.delete(&url).send().await?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(R2Error::Api(format!("Delete failed: {}", text)));
    }

    Ok(())
}

/// Retrieves the public domain of a bucket. Checks custom domains first, then the managed .r2.dev sub-domain.
#[tauri::command]
pub async fn get_r2_bucket_domain(bucket_name: String) -> Result<Option<String>, R2Error> {
    let creds = tokio::task::spawn_blocking(read_credentials)
        .await
        .map_err(|e| {
            R2Error::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                e.to_string(),
            ))
        })??;

    let client = CloudflareClient::new(&creds.oauth_token)?;
    let account_id = match creds.account_id {
        Some(id) => id,
        None => resolve_account_id(&client).await?,
    };

    // First, check for custom domains
    let custom_url = format!(
        "accounts/{}/r2/buckets/{}/domains/custom",
        account_id, bucket_name
    );
    if let Ok(resp) = client.get(&custom_url).send().await {
        if let Ok(data) = resp.json::<serde_json::Value>().await {
            if let Some(domains) = data["result"]["domains"].as_array() {
                for d in domains {
                    if d["enabled"].as_bool().unwrap_or(false) {
                        if let Some(domain) = d["domain"].as_str() {
                            return Ok(Some(format!("https://{}", domain)));
                        }
                    }
                }
            }
        }
    }

    // Fallback: check managed domain
    let managed_url = format!(
        "accounts/{}/r2/buckets/{}/domains/managed",
        account_id, bucket_name
    );
    if let Ok(resp) = client.get(&managed_url).send().await {
        if let Ok(data) = resp.json::<serde_json::Value>().await {
            if data["result"]["enabled"].as_bool().unwrap_or(false) {
                if let Some(domain) = data["result"]["domain"].as_str() {
                    return Ok(Some(format!("https://{}", domain)));
                }
            }
        }
    }

    Ok(None)
}
