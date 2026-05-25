use serde::{Deserialize, Serialize};

use crate::cloudflare_auth::{read_credentials, AuthError};
use crate::cloudflare_client::{CfError, CfResponse, CloudflareClient};

#[derive(Debug, Serialize)]
pub struct PermissionCheck {
    pub product: String,
    pub action: String,
    pub status: String,
    pub endpoint: String,
    pub message: String,
    pub missing_permissions: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum PermissionError {
    #[error("Authentication error: {0}")]
    Auth(#[from] AuthError),

    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("Cloudflare API error(s): {0}")]
    Api(String),
}

impl Serialize for PermissionError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Deserialize)]
struct CfAccount {
    id: String,
}

fn api_errors_to_string(errors: &[CfError]) -> String {
    errors
        .iter()
        .map(|e| format!("[{}] {}", e.code, e.message))
        .collect::<Vec<_>>()
        .join("; ")
}

fn read_check(
    product: &str,
    endpoint: &str,
    ok: bool,
    message: String,
    permission: &str,
) -> PermissionCheck {
    PermissionCheck {
        product: product.to_string(),
        action: "read".to_string(),
        status: if ok { "ok" } else { "blocked" }.to_string(),
        endpoint: endpoint.to_string(),
        message,
        missing_permissions: if ok {
            Vec::new()
        } else {
            vec![permission.to_string()]
        },
    }
}

fn write_check(product: &str, endpoint: &str, read_ok: bool, permission: &str) -> PermissionCheck {
    PermissionCheck {
        product: product.to_string(),
        action: "write".to_string(),
        status: if read_ok { "unknown" } else { "blocked" }.to_string(),
        endpoint: endpoint.to_string(),
        message: if read_ok {
            "Write permission is not mutated during this safety check. Real write actions still need the listed Edit permission.".to_string()
        } else {
            "Read access is blocked, so write access is not usable for this product.".to_string()
        },
        missing_permissions: vec![permission.to_string()],
    }
}

async fn probe_read(
    client: &CloudflareClient,
    product: &str,
    endpoint: &str,
    permission: &str,
) -> Result<(PermissionCheck, bool), PermissionError> {
    let resp = client.get(endpoint).send().await?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();

    if !status.is_success() {
        return Ok((
            read_check(
                product,
                endpoint,
                false,
                format!("HTTP {status}: {text}"),
                permission,
            ),
            false,
        ));
    }

    if text.trim().is_empty() {
        return Ok((
            read_check(
                product,
                endpoint,
                true,
                "Endpoint is accessible.".to_string(),
                permission,
            ),
            true,
        ));
    }

    match serde_json::from_str::<CfResponse<serde_json::Value>>(&text) {
        Ok(envelope) if envelope.success => Ok((
            read_check(
                product,
                endpoint,
                true,
                "Endpoint is accessible.".to_string(),
                permission,
            ),
            true,
        )),
        Ok(envelope) => Ok((
            read_check(
                product,
                endpoint,
                false,
                api_errors_to_string(&envelope.errors),
                permission,
            ),
            false,
        )),
        Err(_) => Ok((
            read_check(
                product,
                endpoint,
                true,
                "Endpoint returned a successful non-standard response.".to_string(),
                permission,
            ),
            true,
        )),
    }
}

#[tauri::command]
pub async fn check_cloudflare_permissions() -> Result<Vec<PermissionCheck>, PermissionError> {
    let creds = tokio::task::spawn_blocking(read_credentials)
        .await
        .map_err(|e| PermissionError::Api(e.to_string()))??;

    let client = CloudflareClient::new(&creds.oauth_token)?;
    let accounts_endpoint = "accounts";
    let accounts_resp = client
        .get(accounts_endpoint)
        .send()
        .await?
        .json::<CfResponse<Vec<CfAccount>>>()
        .await?;

    let mut checks = Vec::new();
    if !accounts_resp.success {
        checks.push(read_check(
            "Account",
            accounts_endpoint,
            false,
            api_errors_to_string(&accounts_resp.errors),
            "Account:Read",
        ));
        return Ok(checks);
    }

    checks.push(read_check(
        "Account",
        accounts_endpoint,
        true,
        "The token can list Cloudflare accounts.".to_string(),
        "Account:Read",
    ));

    let account_id = creds.account_id.or_else(|| {
        accounts_resp
            .result
            .and_then(|accounts| accounts.into_iter().next().map(|a| a.id))
    });

    let Some(account_id) = account_id else {
        checks.push(read_check(
            "Account",
            accounts_endpoint,
            false,
            "No Cloudflare account is visible to this token.".to_string(),
            "Account:Read",
        ));
        return Ok(checks);
    };

    let products = [
        (
            "D1",
            format!("accounts/{account_id}/d1/database"),
            "Account D1:Read",
            "Account D1:Edit",
        ),
        (
            "R2",
            format!("accounts/{account_id}/r2/buckets"),
            "Account R2 Storage:Read",
            "Account R2 Storage:Edit",
        ),
        (
            "KV",
            format!("accounts/{account_id}/storage/kv/namespaces"),
            "Account Workers KV Storage:Read",
            "Account Workers KV Storage:Edit",
        ),
    ];

    for (product, endpoint, read_permission, write_permission) in products {
        let (read, read_ok) = probe_read(&client, product, &endpoint, read_permission).await?;
        checks.push(read);
        checks.push(write_check(product, &endpoint, read_ok, write_permission));
    }

    Ok(checks)
}
