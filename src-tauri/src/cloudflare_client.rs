// cloudflare_client.rs
//
// A thin wrapper around `reqwest::Client` that attaches the Cloudflare
// Bearer token to every request. All future API modules (D1, KV, R2 …)
// should obtain a client through `CloudflareClient::new()`.

use reqwest::{
    header::{HeaderMap, HeaderValue, AUTHORIZATION, USER_AGENT},
    Client, ClientBuilder,
};
use serde::{Deserialize, Deserializer};

const CF_API_BASE: &str = "https://api.cloudflare.com/client/v4";
const USER_AGENT_STR: &str = concat!("CFDesk/", env!("CARGO_PKG_VERSION"));

// ── Cloudflare API envelope ────────────────────────────────────────────────────

/// Every Cloudflare v4 response wraps the payload in this envelope.
#[derive(Debug, Deserialize)]
pub struct CfResponse<T> {
    pub result: Option<T>,
    pub success: bool,
    #[serde(default, deserialize_with = "deserialize_null_default")]
    pub errors: Vec<CfError>,
    pub result_info: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct CfError {
    pub code: u32,
    pub message: String,
}

fn deserialize_null_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de> + Default,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

// ── Client ─────────────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
pub struct CloudflareClient {
    inner: Client,
    /// Cached base URL — allows easy override in tests.
    pub base_url: String,
}

impl CloudflareClient {
    /// Build a new client authenticated with the given OAuth token.
    ///
    /// Uses `rustls` for TLS, so no system OpenSSL is required.
    pub fn new(oauth_token: &str) -> Result<Self, reqwest::Error> {
        let mut headers = HeaderMap::new();

        let auth_value = HeaderValue::from_str(&format!("Bearer {oauth_token}"))
            .expect("oauth_token must be a valid ASCII string");

        headers.insert(AUTHORIZATION, auth_value);
        headers.insert(USER_AGENT, HeaderValue::from_static(USER_AGENT_STR));

        let inner = ClientBuilder::new()
            .default_headers(headers)
            .use_rustls_tls()
            .build()?;

        Ok(Self {
            inner,
            base_url: CF_API_BASE.to_string(),
        })
    }

    /// Shorthand: GET `{base_url}/{path}`
    pub fn get(&self, path: &str) -> reqwest::RequestBuilder {
        self.inner.get(format!("{}/{}", self.base_url, path))
    }

    /// Shorthand: POST `{base_url}/{path}`
    pub fn post(&self, path: &str) -> reqwest::RequestBuilder {
        self.inner.post(format!("{}/{}", self.base_url, path))
    }

    /// Shorthand: PUT `{base_url}/{path}`
    pub fn put(&self, path: &str) -> reqwest::RequestBuilder {
        self.inner.put(format!("{}/{}", self.base_url, path))
    }

    /// Shorthand: DELETE `{base_url}/{path}`
    pub fn delete(&self, path: &str) -> reqwest::RequestBuilder {
        self.inner.delete(format!("{}/{}", self.base_url, path))
    }

    /// Shorthand: PATCH `{base_url}/{path}`
    pub fn patch(&self, path: &str) -> reqwest::RequestBuilder {
        self.inner.patch(format!("{}/{}", self.base_url, path))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cf_response_accepts_null_errors() {
        let body = r#"{
            "result": [],
            "success": true,
            "errors": null,
            "messages": null,
            "result_info": { "page": 1, "per_page": 100 }
        }"#;

        let response: CfResponse<Vec<serde_json::Value>> = serde_json::from_str(body).unwrap();

        assert!(response.success);
        assert_eq!(response.result.unwrap().len(), 0);
        assert!(response.errors.is_empty());
        assert_eq!(
            response
                .result_info
                .unwrap()
                .get("page")
                .and_then(serde_json::Value::as_u64),
            Some(1)
        );
    }
}
