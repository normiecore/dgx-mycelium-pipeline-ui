use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CapturePayload {
    pub source: String,
    pub content_type: String,
    pub content: String,
    pub captured_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CaptureResponse {
    pub id: String,
    pub status: String,
}

pub async fn send_capture(
    base_url: &str,
    auth_token: &str,
    payload: CapturePayload,
) -> Result<CaptureResponse, String> {
    let client = Client::new();
    let url = format!("{}/api/captures", base_url);

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("HTTP error: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Pipeline returned {}: {}", status, body));
    }

    resp.json::<CaptureResponse>()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))
}
