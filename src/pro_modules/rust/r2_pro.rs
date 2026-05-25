use std::collections::{BTreeMap, HashSet};
use std::io;
use std::sync::{LazyLock, Mutex};

use futures_util::StreamExt;
use hmac::{Hmac, Mac};
use reqwest::header::{
    HeaderMap, HeaderName, HeaderValue, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_TYPE,
};
use reqwest::Method;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio_util::codec::{BytesCodec, FramedRead};

use crate::cloudflare_auth::read_credentials;
use crate::cloudflare_client::{CfError, CfResponse, CloudflareClient};
use crate::r2::resolve_account_id;

static CANCELLED_UPLOADS: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));
static CANCELLED_DOWNLOADS: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

const R2_MULTIPART_THRESHOLD_BYTES: u64 = 100 * 1024 * 1024;
const R2_MULTIPART_PART_SIZE_BYTES: u64 = 16 * 1024 * 1024;
const R2_MULTIPART_PART_RETRIES: usize = 2;

#[derive(Clone, serde::Serialize)]
struct R2UploadProgress {
    upload_id: String,
    bucket_name: String,
    key: String,
    bytes_sent: u64,
    total_bytes: u64,
    progress: f64,
}

#[derive(Clone, serde::Serialize)]
struct R2DownloadProgress {
    download_id: String,
    bucket_name: String,
    key: String,
    bytes_received: u64,
    total_bytes: u64,
    progress: f64,
}

#[derive(Clone)]
struct R2S3Credentials {
    access_key_id: String,
    secret_access_key: String,
    session_token: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct R2TempCredentialsResult {
    #[serde(rename = "accessKeyId")]
    access_key_id: String,
    #[serde(rename = "secretAccessKey")]
    secret_access_key: String,
    #[serde(rename = "sessionToken")]
    session_token: Option<String>,
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

fn clear_cancelled_download(download_id: &str) {
    if let Ok(mut cancelled) = CANCELLED_DOWNLOADS.lock() {
        cancelled.remove(download_id);
    }
}

fn is_download_cancelled(download_id: &str) -> bool {
    CANCELLED_DOWNLOADS
        .lock()
        .map(|cancelled| cancelled.contains(download_id))
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

fn emit_download_progress(
    app: &AppHandle,
    download_id: &str,
    bucket_name: &str,
    key: &str,
    bytes_received: u64,
    total_bytes: u64,
) {
    let progress = if total_bytes == 0 {
        0.0
    } else {
        ((bytes_received as f64 / total_bytes as f64) * 100.0).clamp(0.0, 100.0)
    };
    let _ = app.emit(
        "r2-download-progress",
        R2DownloadProgress {
            download_id: download_id.to_string(),
            bucket_name: bucket_name.to_string(),
            key: key.to_string(),
            bytes_received,
            total_bytes,
            progress,
        },
    );
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn hmac_sha256(key: &[u8], value: &str) -> Vec<u8> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(value.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

fn aws_signing_key(secret_access_key: &str, date: &str) -> Vec<u8> {
    let date_key = hmac_sha256(format!("AWS4{secret_access_key}").as_bytes(), date);
    let region_key = hmac_sha256(&date_key, "auto");
    let service_key = hmac_sha256(&region_key, "s3");
    hmac_sha256(&service_key, "aws4_request")
}

fn s3_encode_path_segment(value: &str) -> String {
    urlencoding::encode(value).into_owned()
}

fn s3_canonical_uri(bucket_name: &str, key: &str) -> String {
    let encoded_key = key
        .split('/')
        .map(s3_encode_path_segment)
        .collect::<Vec<_>>()
        .join("/");
    format!("/{}/{}", s3_encode_path_segment(bucket_name), encoded_key)
}

fn trim_header_value(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn xml_text(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn xml_unescape_text(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

fn extract_xml_tag(text: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = text.find(&open)? + open.len();
    let end = text[start..].find(&close)? + start;
    Some(xml_unescape_text(&text[start..end]))
}

fn signed_s3_headers(
    credentials: &R2S3Credentials,
    method: &Method,
    host: &str,
    canonical_uri: &str,
    canonical_query: &str,
    payload_hash: &str,
    extra_headers: BTreeMap<String, String>,
) -> Result<HeaderMap, String> {
    let now = chrono::Utc::now();
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let date = now.format("%Y%m%d").to_string();
    let credential_scope = format!("{date}/auto/s3/aws4_request");

    let mut headers = BTreeMap::new();
    headers.insert("host".to_string(), host.to_string());
    headers.insert("x-amz-content-sha256".to_string(), payload_hash.to_string());
    headers.insert("x-amz-date".to_string(), amz_date);
    if let Some(session_token) = credentials.session_token.as_ref() {
        headers.insert(
            "x-amz-security-token".to_string(),
            session_token.to_string(),
        );
    }
    for (key, value) in extra_headers {
        let value = value.trim();
        if !value.is_empty() {
            headers.insert(key.to_ascii_lowercase(), value.to_string());
        }
    }

    let canonical_headers = headers
        .iter()
        .map(|(key, value)| format!("{key}:{}\n", trim_header_value(value)))
        .collect::<String>();
    let signed_headers = headers.keys().cloned().collect::<Vec<_>>().join(";");
    let canonical_request = format!(
        "{}\n{canonical_uri}\n{canonical_query}\n{canonical_headers}\n{signed_headers}\n{payload_hash}",
        method.as_str()
    );
    let canonical_request_hash = sha256_hex(canonical_request.as_bytes());
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{credential_scope}\n{canonical_request_hash}",
        headers
            .get("x-amz-date")
            .ok_or_else(|| "Missing x-amz-date.".to_string())?
    );
    let signing_key = aws_signing_key(&credentials.secret_access_key, &date);
    let signature = hex::encode(hmac_sha256(&signing_key, &string_to_sign));
    let authorization = format!(
        "AWS4-HMAC-SHA256 Credential={}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}",
        credentials.access_key_id
    );

    let mut header_map = HeaderMap::new();
    for (key, value) in headers {
        let header_name = HeaderName::from_bytes(key.as_bytes()).map_err(|err| err.to_string())?;
        let header_value = HeaderValue::from_str(&value).map_err(|err| err.to_string())?;
        header_map.insert(header_name, header_value);
    }
    header_map.insert(
        HeaderName::from_static("authorization"),
        HeaderValue::from_str(&authorization).map_err(|err| err.to_string())?,
    );
    Ok(header_map)
}

async fn read_file_part(path: &str, offset: u64, size: u64) -> Result<Vec<u8>, String> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|e| format!("Failed to open local file: {e}"))?;
    file.seek(std::io::SeekFrom::Start(offset))
        .await
        .map_err(|e| format!("Failed to seek local file: {e}"))?;
    let mut buffer = vec![0u8; size as usize];
    file.read_exact(&mut buffer)
        .await
        .map_err(|e| format!("Failed to read local file part: {e}"))?;
    Ok(buffer)
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

async fn current_token_id(client: &CloudflareClient) -> Result<String, String> {
    let resp = client
        .get("user/tokens/verify")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(format!(
            "R2 multipart upload needs a verifiable Cloudflare R2 API token with R2 object write access. HTTP {status}: {text}"
        ));
    }

    let envelope: CfResponse<Value> = serde_json::from_str(&text).map_err(|err| {
        format!("Failed to parse Cloudflare token verification response: {err}. Body: {text}")
    })?;

    if !envelope.success {
        return Err(api_errors_to_string(&envelope.errors));
    }

    envelope
        .result
        .and_then(|value| {
            value
                .get("id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .ok_or_else(|| {
            "Cloudflare did not return a token id for temporary R2 credentials.".to_string()
        })
}

async fn create_r2_temp_credentials(
    client: &CloudflareClient,
    account_id: &str,
    bucket_name: &str,
    key: &str,
) -> Result<R2S3Credentials, String> {
    let parent_access_key_id = current_token_id(client).await?;
    let endpoint = format!("accounts/{account_id}/r2/temp-access-credentials");
    let resp = client
        .post(&endpoint)
        .json(&json!({
            "bucket": bucket_name,
            "parentAccessKeyId": parent_access_key_id,
            "permission": "object-read-write",
            "ttlSeconds": 3600,
            "objects": [key],
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(format!(
            "Create R2 temporary S3 credentials failed with HTTP {status}: {text}"
        ));
    }

    let envelope: CfResponse<R2TempCredentialsResult> =
        serde_json::from_str(&text).map_err(|err| {
            format!("Failed to parse R2 temporary credentials response: {err}. Body: {text}")
        })?;

    if !envelope.success {
        return Err(api_errors_to_string(&envelope.errors));
    }

    let result = envelope
        .result
        .ok_or_else(|| "Cloudflare did not return R2 temporary S3 credentials.".to_string())?;

    Ok(R2S3Credentials {
        access_key_id: result.access_key_id,
        secret_access_key: result.secret_access_key,
        session_token: result.session_token,
    })
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

    if total_bytes >= R2_MULTIPART_THRESHOLD_BYTES {
        return upload_r2_object_multipart(
            app,
            bucket_name,
            key,
            local_path,
            upload_id,
            cache_control,
            content_type,
            total_bytes,
        )
        .await;
    }

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

async fn upload_r2_object_multipart(
    app: AppHandle,
    bucket_name: String,
    key: String,
    local_path: String,
    upload_id: String,
    cache_control: Option<String>,
    content_type: String,
    total_bytes: u64,
) -> Result<(), String> {
    let setup_result = async {
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
        let s3_credentials =
            create_r2_temp_credentials(&client, &account_id, &bucket_name, &key).await?;
        Ok::<_, String>((account_id, s3_credentials))
    }
    .await;

    let (account_id, s3_credentials) = match setup_result {
        Ok(value) => value,
        Err(err) => {
            clear_cancelled_upload(&upload_id);
            return Err(err);
        }
    };
    let s3_client = reqwest::Client::new();
    let host = format!("{account_id}.r2.cloudflarestorage.com");
    let canonical_uri = s3_canonical_uri(&bucket_name, &key);
    let object_url = format!("https://{host}{canonical_uri}");

    emit_upload_progress(&app, &upload_id, &bucket_name, &key, 0, total_bytes);

    let empty_hash = sha256_hex(b"");
    let mut init_extra_headers = BTreeMap::new();
    init_extra_headers.insert("content-type".to_string(), content_type);
    if let Some(cache_control) = cache_control.filter(|value| !value.trim().is_empty()) {
        init_extra_headers.insert("cache-control".to_string(), cache_control);
    }
    let init_headers = match signed_s3_headers(
        &s3_credentials,
        &Method::POST,
        &host,
        &canonical_uri,
        "uploads=",
        &empty_hash,
        init_extra_headers,
    ) {
        Ok(headers) => headers,
        Err(err) => {
            clear_cancelled_upload(&upload_id);
            return Err(err);
        }
    };
    let init_resp = s3_client
        .post(format!("{object_url}?uploads="))
        .headers(init_headers)
        .body(Vec::new())
        .send()
        .await
        .map_err(|e| format!("Failed to start multipart upload: {e}"))?;
    let init_status = init_resp.status();
    let init_text = init_resp.text().await.unwrap_or_default();
    if !init_status.is_success() {
        clear_cancelled_upload(&upload_id);
        return Err(format!(
            "Start multipart upload failed with HTTP {init_status}: {init_text}"
        ));
    }
    let multipart_upload_id = match extract_xml_tag(&init_text, "UploadId") {
        Some(id) => id,
        None => {
            clear_cancelled_upload(&upload_id);
            return Err(format!(
                "R2 did not return a multipart upload id: {init_text}"
            ));
        }
    };

    let upload_result = async {
        let total_parts =
            (total_bytes + R2_MULTIPART_PART_SIZE_BYTES - 1) / R2_MULTIPART_PART_SIZE_BYTES;
        let mut completed_parts: Vec<(u64, String)> = Vec::new();
        let mut uploaded_bytes = 0u64;

        for part_number in 1..=total_parts {
            if is_upload_cancelled(&upload_id) {
                return Err("Upload canceled.".to_string());
            }

            let offset = (part_number - 1) * R2_MULTIPART_PART_SIZE_BYTES;
            let part_size = (total_bytes - offset).min(R2_MULTIPART_PART_SIZE_BYTES);
            let part_bytes = read_file_part(&local_path, offset, part_size).await?;
            let part_payload_hash = sha256_hex(&part_bytes);
            let query = format!(
                "partNumber={part_number}&uploadId={}",
                urlencoding::encode(&multipart_upload_id)
            );
            let part_url = format!("{object_url}?{query}");
            let mut last_error: Option<String> = None;

            for _attempt in 0..=R2_MULTIPART_PART_RETRIES {
                if is_upload_cancelled(&upload_id) {
                    return Err("Upload canceled.".to_string());
                }
                let part_headers = signed_s3_headers(
                    &s3_credentials,
                    &Method::PUT,
                    &host,
                    &canonical_uri,
                    &query,
                    &part_payload_hash,
                    BTreeMap::new(),
                )?;
                let part_resp = s3_client
                    .put(&part_url)
                    .headers(part_headers)
                    .body(part_bytes.clone())
                    .send()
                    .await;

                match part_resp {
                    Ok(resp) if resp.status().is_success() => {
                        let etag = resp
                            .headers()
                            .get("etag")
                            .and_then(|value| value.to_str().ok())
                            .map(ToOwned::to_owned)
                            .ok_or_else(|| {
                                format!("Multipart part {part_number} uploaded without an ETag.")
                            })?;
                        completed_parts.push((part_number, etag));
                        uploaded_bytes += part_size;
                        emit_upload_progress(
                            &app,
                            &upload_id,
                            &bucket_name,
                            &key,
                            uploaded_bytes,
                            total_bytes,
                        );
                        last_error = None;
                        break;
                    }
                    Ok(resp) => {
                        let status = resp.status();
                        let text = resp.text().await.unwrap_or_default();
                        last_error = Some(format!(
                            "Multipart part {part_number} failed with HTTP {status}: {text}"
                        ));
                    }
                    Err(err) => {
                        last_error =
                            Some(format!("Multipart part {part_number} upload failed: {err}"));
                    }
                }
            }

            if let Some(error) = last_error {
                return Err(error);
            }
        }

        if is_upload_cancelled(&upload_id) {
            return Err("Upload canceled.".to_string());
        }

        completed_parts.sort_by_key(|(part_number, _)| *part_number);
        let complete_xml = format!(
            "<CompleteMultipartUpload>{}</CompleteMultipartUpload>",
            completed_parts
                .iter()
                .map(|(part_number, etag)| {
                    format!(
                        "<Part><PartNumber>{part_number}</PartNumber><ETag>{}</ETag></Part>",
                        xml_text(etag)
                    )
                })
                .collect::<String>()
        );
        let complete_hash = sha256_hex(complete_xml.as_bytes());
        let complete_query = format!("uploadId={}", urlencoding::encode(&multipart_upload_id));
        let mut complete_extra_headers = BTreeMap::new();
        complete_extra_headers.insert("content-type".to_string(), "application/xml".to_string());
        let complete_headers = signed_s3_headers(
            &s3_credentials,
            &Method::POST,
            &host,
            &canonical_uri,
            &complete_query,
            &complete_hash,
            complete_extra_headers,
        )?;
        let complete_resp = s3_client
            .post(format!("{object_url}?{complete_query}"))
            .headers(complete_headers)
            .body(complete_xml)
            .send()
            .await
            .map_err(|e| format!("Failed to complete multipart upload: {e}"))?;
        let complete_status = complete_resp.status();
        let complete_text = complete_resp.text().await.unwrap_or_default();
        if !complete_status.is_success() {
            return Err(format!(
                "Complete multipart upload failed with HTTP {complete_status}: {complete_text}"
            ));
        }

        emit_upload_progress(
            &app,
            &upload_id,
            &bucket_name,
            &key,
            total_bytes,
            total_bytes,
        );
        Ok(())
    }
    .await;

    if upload_result.is_err() || is_upload_cancelled(&upload_id) {
        let abort_hash = sha256_hex(b"");
        let abort_query = format!("uploadId={}", urlencoding::encode(&multipart_upload_id));
        if let Ok(abort_headers) = signed_s3_headers(
            &s3_credentials,
            &Method::DELETE,
            &host,
            &canonical_uri,
            &abort_query,
            &abort_hash,
            BTreeMap::new(),
        ) {
            let _ = s3_client
                .delete(format!("{object_url}?{abort_query}"))
                .headers(abort_headers)
                .send()
                .await;
        }
    }

    clear_cancelled_upload(&upload_id);
    upload_result
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
    app: AppHandle,
    bucket_name: String,
    key: String,
    destination_path: String,
    download_id: Option<String>,
) -> Result<(), String> {
    let download_id = download_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    clear_cancelled_download(&download_id);

    let (client, account_id) = client_and_account().await?;
    let url = format!(
        "accounts/{account_id}/r2/buckets/{bucket_name}/objects/{}",
        urlencoding::encode(&key)
    );

    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Download failed with HTTP {status}: {text}"));
    }

    let total_bytes = resp
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);

    if let Some(parent) = std::path::Path::new(&destination_path).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create destination directory: {e}"))?;
    }

    emit_download_progress(&app, &download_id, &bucket_name, &key, 0, total_bytes);

    let mut file = tokio::fs::File::create(&destination_path)
        .await
        .map_err(|e| format!("Failed to create destination file: {e}"))?;
    let mut stream = resp.bytes_stream();
    let mut bytes_received = 0u64;

    while let Some(chunk) = stream.next().await {
        if is_download_cancelled(&download_id) {
            clear_cancelled_download(&download_id);
            let _ = tokio::fs::remove_file(&destination_path).await;
            return Err("Download canceled.".to_string());
        }

        let chunk = chunk.map_err(|e| format!("Failed to download object: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed to write destination file: {e}"))?;
        bytes_received += chunk.len() as u64;
        emit_download_progress(
            &app,
            &download_id,
            &bucket_name,
            &key,
            bytes_received,
            total_bytes,
        );
    }

    if is_download_cancelled(&download_id) {
        clear_cancelled_download(&download_id);
        let _ = tokio::fs::remove_file(&destination_path).await;
        return Err("Download canceled.".to_string());
    }

    file.flush()
        .await
        .map_err(|e| format!("Failed to flush destination file: {e}"))?;

    emit_download_progress(
        &app,
        &download_id,
        &bucket_name,
        &key,
        bytes_received,
        if total_bytes == 0 {
            bytes_received
        } else {
            total_bytes
        },
    );
    clear_cancelled_download(&download_id);

    Ok(())
}

#[tauri::command]
pub async fn cancel_download_r2_object(
    download_id: String,
    _bucket_name: String,
    _key: String,
) -> Result<(), String> {
    if let Ok(mut cancelled) = CANCELLED_DOWNLOADS.lock() {
        cancelled.insert(download_id);
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_hex_matches_known_value() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn s3_canonical_uri_preserves_path_separators() {
        assert_eq!(
            s3_canonical_uri("my-bucket", "images/hello world+1.png"),
            "/my-bucket/images/hello%20world%2B1.png"
        );
    }

    #[test]
    fn extract_xml_tag_unescapes_value() {
        assert_eq!(
            extract_xml_tag(
                "<Root><UploadId>a&amp;b&lt;c&gt;</UploadId></Root>",
                "UploadId"
            ),
            Some("a&b<c>".to_string())
        );
    }
}
