use reqwest::{header::CONTENT_TYPE, multipart};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::cloudflare_auth::{read_credentials, AuthError};
use crate::cloudflare_client::{CfError, CfResponse, CloudflareClient};

#[derive(Debug, thiserror::Error)]
pub enum RemoteResourceError {
    #[error("Authentication error: {0}")]
    Auth(#[from] AuthError),

    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("Could not determine your Cloudflare account ID.")]
    NoAccountId,

    #[error("Cloudflare API error(s): {0}")]
    Api(String),

    #[error("Invalid JSON body: {0}")]
    Json(String),
}

impl Serialize for RemoteResourceError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Deserialize)]
struct CfAccount {
    id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KVNamespace {
    pub id: String,
    pub title: String,
    pub supports_url_encoding: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KVKey {
    pub name: String,
    pub expiration: Option<f64>,
    pub metadata: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KVKeyListResult {
    pub keys: Vec<KVKey>,
    pub cursor: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KVEntry {
    pub key: String,
    pub value: String,
    pub metadata: Option<Value>,
    pub expiration: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RemoteSection {
    pub data: Option<Value>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkersOverview {
    pub account_id: String,
    pub account_subdomain: Option<String>,
    pub subdomain_error: Option<String>,
    pub domains_error: Option<String>,
    pub workers: Vec<WorkerSummary>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkerSummary {
    pub name: String,
    pub created_on: Option<String>,
    pub modified_on: Option<String>,
    pub last_deployed_from: Option<String>,
    pub workers_dev_url: Option<String>,
    pub routes: Vec<Value>,
    pub domains: Vec<Value>,
    pub bindings: Vec<Value>,
    pub observability: Option<Value>,
    pub raw: Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkerDetail {
    pub account_id: String,
    pub account_subdomain: Option<String>,
    pub script: Value,
    pub domains: Vec<Value>,
    pub subdomain: RemoteSection,
    pub settings: RemoteSection,
    pub script_settings: RemoteSection,
    pub deployments: RemoteSection,
    pub versions: RemoteSection,
    pub secrets: RemoteSection,
    pub schedules: RemoteSection,
    pub tails: RemoteSection,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkerMetrics {
    pub start: String,
    pub end: String,
    pub rows: Vec<Value>,
    pub raw: Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QueuesOverview {
    pub account_id: String,
    pub queues: Vec<Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QueueDetail {
    pub queue: RemoteSection,
    pub metrics: RemoteSection,
}

fn api_errors_to_string(errors: &[CfError]) -> String {
    errors
        .iter()
        .map(|e| format!("[{}] {}", e.code, e.message))
        .collect::<Vec<_>>()
        .join("; ")
}

async fn resolve_account_id(client: &CloudflareClient) -> Result<String, RemoteResourceError> {
    let resp = client
        .get("accounts")
        .send()
        .await?
        .json::<CfResponse<Vec<CfAccount>>>()
        .await?;

    if !resp.success {
        return Err(RemoteResourceError::Api(api_errors_to_string(&resp.errors)));
    }

    resp.result
        .unwrap_or_default()
        .into_iter()
        .next()
        .map(|account| account.id)
        .ok_or(RemoteResourceError::NoAccountId)
}

async fn client_and_account() -> Result<(CloudflareClient, String), RemoteResourceError> {
    let creds = tokio::task::spawn_blocking(read_credentials)
        .await
        .unwrap_or_else(|e| {
            Err(AuthError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                e.to_string(),
            )))
        })?;

    let client = CloudflareClient::new(&creds.oauth_token)?;
    let account_id = match creds.account_id {
        Some(id) => id,
        None => resolve_account_id(&client).await?,
    };

    Ok((client, account_id))
}

async fn get_result<T: for<'de> Deserialize<'de>>(
    client: &CloudflareClient,
    endpoint: &str,
) -> Result<T, RemoteResourceError> {
    let response = client.get(endpoint).send().await?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(RemoteResourceError::Api(format!("HTTP {status}: {text}")));
    }

    let envelope: CfResponse<T> = serde_json::from_str(&text).map_err(|err| {
        RemoteResourceError::Api(format!(
            "Failed to parse Cloudflare response: {err}. Body: {text}"
        ))
    })?;

    if !envelope.success {
        return Err(RemoteResourceError::Api(api_errors_to_string(
            &envelope.errors,
        )));
    }

    envelope.result.ok_or_else(|| {
        RemoteResourceError::Api("Cloudflare response did not include a result.".to_string())
    })
}

async fn get_section(client: &CloudflareClient, endpoint: &str) -> RemoteSection {
    match get_result::<Value>(client, endpoint).await {
        Ok(data) => RemoteSection {
            data: Some(data),
            error: None,
        },
        Err(err) => RemoteSection {
            data: None,
            error: Some(err.to_string()),
        },
    }
}

async fn parse_cloudflare_write_response(
    response: reqwest::Response,
) -> Result<Value, RemoteResourceError> {
    let status = response.status();
    let text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(RemoteResourceError::Api(format!("HTTP {status}: {text}")));
    }

    if text.trim().is_empty() {
        return Ok(Value::Null);
    }

    let envelope: CfResponse<Value> = serde_json::from_str(&text).map_err(|err| {
        RemoteResourceError::Api(format!(
            "Failed to parse Cloudflare response: {err}. Body: {text}"
        ))
    })?;

    if !envelope.success {
        return Err(RemoteResourceError::Api(api_errors_to_string(
            &envelope.errors,
        )));
    }

    Ok(envelope.result.unwrap_or(Value::Null))
}

fn value_array(value: &Value, field: &str) -> Vec<Value> {
    value
        .get(field)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn value_string(value: &Value, field: &str) -> Option<String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn account_workers_dev_url(account_subdomain: Option<&str>, script_name: &str) -> Option<String> {
    account_subdomain.map(|subdomain| format!("https://{script_name}.{subdomain}.workers.dev"))
}

fn domains_for_script(domains: &[Value], script_name: &str) -> Vec<Value> {
    domains
        .iter()
        .filter(|domain| {
            domain
                .get("service")
                .and_then(Value::as_str)
                .map(|service| service == script_name)
                .unwrap_or(false)
        })
        .cloned()
        .collect()
}

fn worker_from_script(
    script: Value,
    account_subdomain: Option<&str>,
    domains: &[Value],
) -> Option<WorkerSummary> {
    let name = value_string(&script, "id").or_else(|| value_string(&script, "name"))?;
    Some(WorkerSummary {
        name: name.clone(),
        created_on: value_string(&script, "created_on"),
        modified_on: value_string(&script, "modified_on"),
        last_deployed_from: value_string(&script, "last_deployed_from"),
        workers_dev_url: account_workers_dev_url(account_subdomain, &name),
        routes: value_array(&script, "routes"),
        domains: domains_for_script(domains, &name),
        bindings: value_array(&script, "bindings"),
        observability: script.get("observability").cloned(),
        raw: script,
    })
}

#[tauri::command]
pub async fn fetch_kv_namespaces() -> Result<Vec<KVNamespace>, RemoteResourceError> {
    let (client, account_id) = client_and_account().await?;
    get_result::<Vec<KVNamespace>>(
        &client,
        &format!("accounts/{account_id}/storage/kv/namespaces"),
    )
    .await
}

#[tauri::command]
pub async fn list_kv_keys(
    namespace_id: String,
    prefix: Option<String>,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<KVKeyListResult, RemoteResourceError> {
    let (client, account_id) = client_and_account().await?;
    let mut endpoint = format!(
        "accounts/{account_id}/storage/kv/namespaces/{namespace_id}/keys?limit={}",
        limit.unwrap_or(100).clamp(1, 1000)
    );

    if let Some(prefix) = prefix.filter(|value| !value.is_empty()) {
        endpoint.push_str("&prefix=");
        endpoint.push_str(&urlencoding::encode(&prefix));
    }
    if let Some(cursor) = cursor.filter(|value| !value.is_empty()) {
        endpoint.push_str("&cursor=");
        endpoint.push_str(&urlencoding::encode(&cursor));
    }

    let response = client.get(&endpoint).send().await?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(RemoteResourceError::Api(format!("HTTP {status}: {text}")));
    }

    let envelope: CfResponse<Vec<KVKey>> = serde_json::from_str(&text).map_err(|err| {
        RemoteResourceError::Api(format!(
            "Failed to parse Cloudflare response: {err}. Body: {text}"
        ))
    })?;

    if !envelope.success {
        return Err(RemoteResourceError::Api(api_errors_to_string(
            &envelope.errors,
        )));
    }

    let cursor = envelope.result_info.and_then(|info| {
        info.get("cursor")
            .and_then(Value::as_str)
            .map(ToString::to_string)
    });

    Ok(KVKeyListResult {
        keys: envelope.result.unwrap_or_default(),
        cursor,
    })
}

#[tauri::command]
pub async fn get_kv_entry(
    namespace_id: String,
    key_name: String,
) -> Result<KVEntry, RemoteResourceError> {
    let (client, account_id) = client_and_account().await?;
    let encoded_key = urlencoding::encode(&key_name);
    let metadata_endpoint = format!(
        "accounts/{account_id}/storage/kv/namespaces/{namespace_id}/metadata/{encoded_key}"
    );
    let value_endpoint =
        format!("accounts/{account_id}/storage/kv/namespaces/{namespace_id}/values/{encoded_key}");

    let metadata = match get_result::<Value>(&client, &metadata_endpoint).await {
        Ok(value) => Some(value),
        Err(_) => None,
    };

    let response = client.get(&value_endpoint).send().await?;
    let status = response.status();
    let expiration = response
        .headers()
        .get("expiration")
        .and_then(|value| value.to_str().ok())
        .map(ToString::to_string);
    let value = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(RemoteResourceError::Api(format!("HTTP {status}: {value}")));
    }

    Ok(KVEntry {
        key: key_name,
        value,
        metadata,
        expiration,
    })
}

#[tauri::command]
pub async fn put_kv_entry(
    namespace_id: String,
    key_name: String,
    value: String,
    expiration_ttl: Option<u64>,
    expiration: Option<String>,
    metadata: Option<Value>,
) -> Result<(), RemoteResourceError> {
    let (client, account_id) = client_and_account().await?;
    let encoded_key = urlencoding::encode(&key_name);
    let mut endpoint =
        format!("accounts/{account_id}/storage/kv/namespaces/{namespace_id}/values/{encoded_key}");
    if let Some(ttl) = expiration_ttl.filter(|ttl| *ttl > 0) {
        endpoint.push_str("?expiration_ttl=");
        endpoint.push_str(&ttl.to_string());
    } else if let Some(expiration) = expiration
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.chars().all(|ch| ch.is_ascii_digit()))
    {
        endpoint.push_str("?expiration=");
        endpoint.push_str(expiration);
    }

    let request = client.put(&endpoint);
    let response = if let Some(metadata) = metadata {
        request
            .multipart(
                multipart::Form::new()
                    .text("value", value)
                    .text("metadata", metadata.to_string()),
            )
            .send()
            .await?
    } else {
        request
            .header(CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(value)
            .send()
            .await?
    };
    let status = response.status();
    let text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(RemoteResourceError::Api(format!("HTTP {status}: {text}")));
    }

    if text.trim().is_empty() {
        return Ok(());
    }

    let envelope: CfResponse<Value> = serde_json::from_str(&text).map_err(|err| {
        RemoteResourceError::Api(format!(
            "Failed to parse Cloudflare response: {err}. Body: {text}"
        ))
    })?;

    if !envelope.success {
        return Err(RemoteResourceError::Api(api_errors_to_string(
            &envelope.errors,
        )));
    }

    Ok(())
}

#[tauri::command]
pub async fn delete_kv_entry(
    namespace_id: String,
    key_name: String,
) -> Result<(), RemoteResourceError> {
    let (client, account_id) = client_and_account().await?;
    let encoded_key = urlencoding::encode(&key_name);
    let endpoint =
        format!("accounts/{account_id}/storage/kv/namespaces/{namespace_id}/values/{encoded_key}");
    let response = client.delete(&endpoint).send().await?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(RemoteResourceError::Api(format!("HTTP {status}: {text}")));
    }

    Ok(())
}

#[tauri::command]
pub async fn fetch_workers_overview() -> Result<WorkersOverview, RemoteResourceError> {
    let (client, account_id) = client_and_account().await?;
    let scripts =
        get_result::<Vec<Value>>(&client, &format!("accounts/{account_id}/workers/scripts"))
            .await?;

    let subdomain_section =
        get_section(&client, &format!("accounts/{account_id}/workers/subdomain")).await;
    let account_subdomain = subdomain_section
        .data
        .as_ref()
        .and_then(|value| value.get("subdomain"))
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let domains_section =
        get_section(&client, &format!("accounts/{account_id}/workers/domains")).await;
    let domains = domains_section
        .data
        .as_ref()
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let workers = scripts
        .into_iter()
        .filter_map(|script| worker_from_script(script, account_subdomain.as_deref(), &domains))
        .collect();

    Ok(WorkersOverview {
        account_id,
        account_subdomain,
        subdomain_error: subdomain_section.error,
        domains_error: domains_section.error,
        workers,
    })
}

#[tauri::command]
pub async fn fetch_worker_detail(script_name: String) -> Result<WorkerDetail, RemoteResourceError> {
    let (client, account_id) = client_and_account().await?;
    let encoded_script = urlencoding::encode(&script_name);

    let scripts =
        get_result::<Vec<Value>>(&client, &format!("accounts/{account_id}/workers/scripts"))
            .await?;
    let script = scripts
        .into_iter()
        .find(|script| {
            value_string(script, "id")
                .or_else(|| value_string(script, "name"))
                .map(|name| name == script_name)
                .unwrap_or(false)
        })
        .ok_or_else(|| RemoteResourceError::Api(format!("Worker not found: {script_name}")))?;

    let account_subdomain =
        get_section(&client, &format!("accounts/{account_id}/workers/subdomain"))
            .await
            .data
            .and_then(|value| {
                value
                    .get("subdomain")
                    .and_then(Value::as_str)
                    .map(ToString::to_string)
            });

    let domains_section = get_section(
        &client,
        &format!("accounts/{account_id}/workers/domains?service={encoded_script}"),
    )
    .await;
    let domains = domains_section
        .data
        .as_ref()
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let subdomain = get_section(
        &client,
        &format!("accounts/{account_id}/workers/scripts/{encoded_script}/subdomain"),
    )
    .await;
    let settings = get_section(
        &client,
        &format!("accounts/{account_id}/workers/scripts/{encoded_script}/settings"),
    )
    .await;
    let script_settings = get_section(
        &client,
        &format!("accounts/{account_id}/workers/scripts/{encoded_script}/script-settings"),
    )
    .await;
    let deployments = get_section(
        &client,
        &format!("accounts/{account_id}/workers/scripts/{encoded_script}/deployments"),
    )
    .await;
    let versions = get_section(
        &client,
        &format!("accounts/{account_id}/workers/scripts/{encoded_script}/versions"),
    )
    .await;
    let secrets = get_section(
        &client,
        &format!("accounts/{account_id}/workers/scripts/{encoded_script}/secrets"),
    )
    .await;
    let schedules = get_section(
        &client,
        &format!("accounts/{account_id}/workers/scripts/{encoded_script}/schedules"),
    )
    .await;
    let tails = get_section(
        &client,
        &format!("accounts/{account_id}/workers/scripts/{encoded_script}/tails"),
    )
    .await;

    Ok(WorkerDetail {
        account_id,
        account_subdomain,
        script,
        domains,
        subdomain,
        settings,
        script_settings,
        deployments,
        versions,
        secrets,
        schedules,
        tails,
    })
}

#[tauri::command]
pub async fn set_worker_subdomain(
    script_name: String,
    enabled: bool,
    previews_enabled: bool,
) -> Result<Value, RemoteResourceError> {
    let (client, account_id) = client_and_account().await?;
    let encoded_script = urlencoding::encode(&script_name);
    let endpoint = format!("accounts/{account_id}/workers/scripts/{encoded_script}/subdomain");

    let response = if enabled {
        client
            .post(&endpoint)
            .json(&json!({
                "enabled": true,
                "previews_enabled": previews_enabled,
            }))
            .send()
            .await?
    } else {
        client.delete(&endpoint).send().await?
    };

    parse_cloudflare_write_response(response).await
}

#[tauri::command]
pub async fn update_worker_schedules(
    script_name: String,
    crons: Vec<String>,
) -> Result<Value, RemoteResourceError> {
    let (client, account_id) = client_and_account().await?;
    let encoded_script = urlencoding::encode(&script_name);
    let endpoint = format!("accounts/{account_id}/workers/scripts/{encoded_script}/schedules");
    let schedules: Vec<Value> = crons
        .into_iter()
        .map(|cron| cron.trim().to_string())
        .filter(|cron| !cron.is_empty())
        .map(|cron| json!({ "cron": cron }))
        .collect();

    let response = client
        .put(&endpoint)
        .json(&json!({ "schedules": schedules }))
        .send()
        .await?;

    parse_cloudflare_write_response(response).await
}

#[tauri::command]
pub async fn start_worker_tail(script_name: String) -> Result<Value, RemoteResourceError> {
    let (client, account_id) = client_and_account().await?;
    let encoded_script = urlencoding::encode(&script_name);
    let endpoint = format!("accounts/{account_id}/workers/scripts/{encoded_script}/tails");
    let response = client.post(&endpoint).send().await?;

    parse_cloudflare_write_response(response).await
}

#[tauri::command]
pub async fn update_worker_observability(
    script_name: String,
    enabled: bool,
    head_sampling_rate: Option<f64>,
    invocation_logs: bool,
) -> Result<Value, RemoteResourceError> {
    let (client, account_id) = client_and_account().await?;
    let encoded_script = urlencoding::encode(&script_name);
    let endpoint =
        format!("accounts/{account_id}/workers/scripts/{encoded_script}/script-settings");

    let sampling_rate = head_sampling_rate.unwrap_or(1.0);
    if !sampling_rate.is_finite() || !(0.0..=1.0).contains(&sampling_rate) {
        return Err(RemoteResourceError::Api(
            "Observability sampling rate must be between 0 and 1.".to_string(),
        ));
    }

    let current_settings = get_result::<Value>(&client, &endpoint).await?;
    let mut observability = current_settings
        .get("observability")
        .filter(|value| value.is_object())
        .cloned()
        .unwrap_or_else(|| json!({}));

    observability["enabled"] = Value::Bool(enabled);
    observability["head_sampling_rate"] = json!(sampling_rate);

    let mut logs = observability
        .get("logs")
        .filter(|value| value.is_object())
        .cloned()
        .unwrap_or_else(|| json!({}));
    logs["enabled"] = Value::Bool(enabled);
    logs["invocation_logs"] = Value::Bool(invocation_logs);
    logs["head_sampling_rate"] = json!(sampling_rate);
    observability["logs"] = logs;

    let response = client
        .patch(&endpoint)
        .json(&json!({ "observability": observability }))
        .send()
        .await?;

    parse_cloudflare_write_response(response).await
}

#[tauri::command]
pub async fn fetch_worker_metrics(
    script_name: String,
    minutes: Option<u32>,
) -> Result<WorkerMetrics, RemoteResourceError> {
    let (client, account_id) = client_and_account().await?;
    let safe_minutes = minutes.unwrap_or(60).clamp(15, 60 * 24 * 7);
    let end = chrono::Utc::now();
    let start = end - chrono::Duration::minutes(safe_minutes as i64);
    let start_string = start.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let end_string = end.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let query = r#"
        query GetWorkersAnalytics(
          $accountTag: string,
          $datetimeStart: string,
          $datetimeEnd: string,
          $scriptName: string
        ) {
          viewer {
            accounts(filter: { accountTag: $accountTag }) {
              workersInvocationsAdaptive(
                limit: 1000,
                filter: {
                  scriptName: $scriptName,
                  datetime_geq: $datetimeStart,
                  datetime_leq: $datetimeEnd
                }
              ) {
                sum {
                  subrequests
                  requests
                  errors
                }
                quantiles {
                  cpuTimeP50
                  cpuTimeP99
                }
                dimensions {
                  datetime
                  scriptName
                  status
                }
              }
            }
          }
        }
    "#;

    let response = client
        .post("graphql")
        .json(&json!({
            "query": query,
            "variables": {
                "accountTag": account_id,
                "datetimeStart": start_string,
                "datetimeEnd": end_string,
                "scriptName": script_name,
            }
        }))
        .send()
        .await?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(RemoteResourceError::Api(format!("HTTP {status}: {text}")));
    }

    let raw: Value = serde_json::from_str(&text).map_err(|err| {
        RemoteResourceError::Api(format!(
            "Failed to parse Cloudflare GraphQL response: {err}. Body: {text}"
        ))
    })?;

    if let Some(errors) = raw.get("errors").and_then(Value::as_array) {
        if !errors.is_empty() {
            return Err(RemoteResourceError::Api(format!(
                "Cloudflare GraphQL error(s): {}",
                serde_json::to_string(errors).unwrap_or_else(|_| "unknown error".to_string())
            )));
        }
    }

    let rows = raw
        .pointer("/data/viewer/accounts/0/workersInvocationsAdaptive")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    Ok(WorkerMetrics {
        start: start_string,
        end: end_string,
        rows,
        raw,
    })
}

#[tauri::command]
pub async fn attach_worker_domain(
    script_name: String,
    hostname: String,
    zone_id: Option<String>,
    zone_name: Option<String>,
    environment: Option<String>,
) -> Result<Value, RemoteResourceError> {
    let (client, account_id) = client_and_account().await?;
    let mut body = json!({
        "hostname": hostname.trim(),
        "service": script_name.trim(),
    });

    if let Some(value) = zone_id.filter(|value| !value.trim().is_empty()) {
        body["zone_id"] = Value::String(value.trim().to_string());
    }
    if let Some(value) = zone_name.filter(|value| !value.trim().is_empty()) {
        body["zone_name"] = Value::String(value.trim().to_string());
    }
    if let Some(value) = environment.filter(|value| !value.trim().is_empty()) {
        body["environment"] = Value::String(value.trim().to_string());
    }

    let response = client
        .put(&format!("accounts/{account_id}/workers/domains"))
        .json(&body)
        .send()
        .await?;

    parse_cloudflare_write_response(response).await
}

#[tauri::command]
pub async fn detach_worker_domain(domain_id: String) -> Result<Value, RemoteResourceError> {
    let (client, account_id) = client_and_account().await?;
    let encoded_domain = urlencoding::encode(&domain_id);
    let response = client
        .delete(&format!(
            "accounts/{account_id}/workers/domains/{encoded_domain}"
        ))
        .send()
        .await?;

    parse_cloudflare_write_response(response).await
}

#[tauri::command]
pub async fn attach_worker_route(
    script_name: String,
    zone_id: String,
    pattern: String,
) -> Result<Value, RemoteResourceError> {
    let (client, _) = client_and_account().await?;
    let encoded_zone = urlencoding::encode(&zone_id);
    let response = client
        .post(&format!("zones/{encoded_zone}/workers/routes"))
        .json(&json!({
            "pattern": pattern.trim(),
            "script": script_name.trim(),
        }))
        .send()
        .await?;

    parse_cloudflare_write_response(response).await
}

#[tauri::command]
pub async fn detach_worker_route(
    zone_id: String,
    route_id: String,
) -> Result<Value, RemoteResourceError> {
    let (client, _) = client_and_account().await?;
    let encoded_zone = urlencoding::encode(&zone_id);
    let encoded_route = urlencoding::encode(&route_id);
    let response = client
        .delete(&format!(
            "zones/{encoded_zone}/workers/routes/{encoded_route}"
        ))
        .send()
        .await?;

    parse_cloudflare_write_response(response).await
}

#[tauri::command]
pub async fn upsert_worker_secret(
    script_name: String,
    secret_name: String,
    secret_value: String,
) -> Result<(), RemoteResourceError> {
    let (client, account_id) = client_and_account().await?;
    let encoded_script = urlencoding::encode(&script_name);
    let endpoint = format!("accounts/{account_id}/workers/scripts/{encoded_script}/secrets");
    let response = client
        .put(&endpoint)
        .json(&json!({
            "name": secret_name,
            "text": secret_value,
            "type": "secret_text",
        }))
        .send()
        .await?;
    parse_cloudflare_write_response(response).await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_worker_secret(
    script_name: String,
    secret_name: String,
) -> Result<(), RemoteResourceError> {
    let (client, account_id) = client_and_account().await?;
    let encoded_script = urlencoding::encode(&script_name);
    let encoded_secret = urlencoding::encode(&secret_name);
    let endpoint =
        format!("accounts/{account_id}/workers/scripts/{encoded_script}/secrets/{encoded_secret}");
    let response = client.delete(&endpoint).send().await?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(RemoteResourceError::Api(format!("HTTP {status}: {text}")));
    }

    Ok(())
}

#[tauri::command]
pub async fn fetch_queues_overview() -> Result<QueuesOverview, RemoteResourceError> {
    let (client, account_id) = client_and_account().await?;
    let queues =
        get_result::<Vec<Value>>(&client, &format!("accounts/{account_id}/queues")).await?;

    Ok(QueuesOverview { account_id, queues })
}

#[tauri::command]
pub async fn fetch_queue_detail(queue_id: String) -> Result<QueueDetail, RemoteResourceError> {
    let (client, account_id) = client_and_account().await?;
    let encoded_queue = urlencoding::encode(&queue_id);
    let queue = get_section(
        &client,
        &format!("accounts/{account_id}/queues/{encoded_queue}"),
    )
    .await;
    let metrics = get_section(
        &client,
        &format!("accounts/{account_id}/queues/{encoded_queue}/metrics"),
    )
    .await;

    Ok(QueueDetail { queue, metrics })
}

#[tauri::command]
pub async fn send_queue_message(
    queue_id: String,
    body: String,
    content_type: String,
    delay_seconds: Option<u64>,
) -> Result<Value, RemoteResourceError> {
    let (client, account_id) = client_and_account().await?;
    let encoded_queue = urlencoding::encode(&queue_id);
    let payload_body = if content_type == "json" {
        serde_json::from_str::<Value>(&body)
            .map_err(|err| RemoteResourceError::Json(err.to_string()))?
    } else {
        Value::String(body)
    };
    let mut payload = json!({
        "body": payload_body,
        "content_type": if content_type == "json" { "json" } else { "text" },
    });
    if let Some(delay) = delay_seconds.filter(|delay| *delay > 0) {
        payload["delay_seconds"] = Value::from(delay);
    }

    let endpoint = format!("accounts/{account_id}/queues/{encoded_queue}/messages");
    let response = client.post(&endpoint).json(&payload).send().await?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(RemoteResourceError::Api(format!("HTTP {status}: {text}")));
    }

    let envelope: CfResponse<Value> = serde_json::from_str(&text).map_err(|err| {
        RemoteResourceError::Api(format!(
            "Failed to parse Cloudflare response: {err}. Body: {text}"
        ))
    })?;

    if !envelope.success {
        return Err(RemoteResourceError::Api(api_errors_to_string(
            &envelope.errors,
        )));
    }

    Ok(envelope.result.unwrap_or(Value::Null))
}

#[tauri::command]
pub async fn send_queue_batch(
    queue_id: String,
    messages: Vec<String>,
    content_type: String,
    delay_seconds: Option<u64>,
) -> Result<Value, RemoteResourceError> {
    let (client, account_id) = client_and_account().await?;
    let encoded_queue = urlencoding::encode(&queue_id);
    let mut payload_messages = Vec::new();

    for message in messages
        .into_iter()
        .filter(|message| !message.trim().is_empty())
    {
        let body = if content_type == "json" {
            serde_json::from_str::<Value>(&message)
                .map_err(|err| RemoteResourceError::Json(err.to_string()))?
        } else {
            Value::String(message)
        };
        let mut item = json!({
            "body": body,
            "content_type": if content_type == "json" { "json" } else { "text" },
        });
        if let Some(delay) = delay_seconds.filter(|delay| *delay > 0) {
            item["delay_seconds"] = Value::from(delay);
        }
        payload_messages.push(item);
    }

    let mut payload = json!({ "messages": payload_messages });
    if let Some(delay) = delay_seconds.filter(|delay| *delay > 0) {
        payload["delay_seconds"] = Value::from(delay);
    }

    let endpoint = format!("accounts/{account_id}/queues/{encoded_queue}/messages/batch");
    let response = client.post(&endpoint).json(&payload).send().await?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(RemoteResourceError::Api(format!("HTTP {status}: {text}")));
    }

    let envelope: CfResponse<Value> = serde_json::from_str(&text).map_err(|err| {
        RemoteResourceError::Api(format!(
            "Failed to parse Cloudflare response: {err}. Body: {text}"
        ))
    })?;

    if !envelope.success {
        return Err(RemoteResourceError::Api(api_errors_to_string(
            &envelope.errors,
        )));
    }

    Ok(envelope.result.unwrap_or(Value::Null))
}
