//! The optional LanguageTool layer (brief §7).
//!
//! Three rules shape this file:
//!
//! 1. **Nothing is contacted unless the writer configured an endpoint.** The
//!    frontend's language policy decides that; this module is only reached
//!    for a paragraph that policy already cleared.
//! 2. **LanguageTool is LGPL, so it stays a separate process.** Sheaf speaks
//!    to its HTTP API and links none of it.
//! 3. **Plain HTTP only.** `https://` is refused, which means the endpoint
//!    can only be a server the writer runs — on this machine or their own
//!    network — and never a cloud service quietly collecting a manuscript.
//!    Allowing TLS later is one Cargo feature (`ureq/rustls`) and an owner
//!    decision; see docs/adr/0003-language-layer.md.
use std::time::Duration;

use serde::Deserialize;

use crate::error::{CmdError, CmdResult};
use crate::grammar::GrammarLint;

const TIMEOUT: Duration = Duration::from_secs(10);
/// Long enough for any paragraph; a whole novel is never sent in one call.
const MAX_TEXT: usize = 60_000;

#[derive(Debug, Deserialize)]
struct LtResponse {
    #[serde(default)]
    matches: Vec<LtMatch>,
}

#[derive(Debug, Deserialize)]
struct LtMatch {
    #[serde(default)]
    message: String,
    offset: usize,
    length: usize,
    #[serde(default)]
    replacements: Vec<LtReplacement>,
    #[serde(default)]
    rule: Option<LtRule>,
}

#[derive(Debug, Deserialize)]
struct LtReplacement {
    #[serde(default)]
    value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LtRule {
    #[serde(default)]
    issue_type: Option<String>,
}

/// Checks that an endpoint is one Sheaf is willing to talk to.
pub fn validate_endpoint(endpoint: &str) -> CmdResult<()> {
    let endpoint = endpoint.trim();
    if endpoint.starts_with("https://") {
        return Err(CmdError::new(
            "endpoint-not-allowed",
            "Sheaf only talks to a LanguageTool server over plain http://, which means one you run yourself.",
        ));
    }
    if !endpoint.starts_with("http://") {
        return Err(CmdError::new(
            "endpoint-not-allowed",
            "A LanguageTool endpoint must start with http://.",
        ));
    }
    Ok(())
}

pub fn check(endpoint: &str, text: &str, language: &str) -> CmdResult<Vec<GrammarLint>> {
    validate_endpoint(endpoint)?;
    if text.len() > MAX_TEXT {
        return Err(CmdError::new(
            "too-long",
            "That paragraph is too long to check.",
        ));
    }

    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(TIMEOUT))
        .user_agent("Sheaf")
        .build()
        .new_agent();

    let response = agent
        .post(endpoint.trim())
        .send_form([
            ("text", text),
            ("language", language),
            // No API key, no user account, nothing identifying.
            ("level", "default"),
        ])
        .map_err(|e| {
            CmdError::new(
                "unreachable",
                format!("LanguageTool could not be reached: {e}"),
            )
        })?;

    let text = response.into_body().read_to_string().map_err(|e| {
        CmdError::new(
            "bad-response",
            format!("LanguageTool's reply could not be read: {e}"),
        )
    })?;
    let body: LtResponse = serde_json::from_str(&text).map_err(|e| {
        CmdError::new(
            "bad-response",
            format!("LanguageTool replied with something Sheaf could not read: {e}"),
        )
    })?;

    Ok(body
        .matches
        .into_iter()
        .map(|m| GrammarLint {
            start: m.offset,
            end: m.offset + m.length,
            kind: m
                .rule
                .and_then(|r| r.issue_type)
                .unwrap_or_else(|| "grammar".to_string()),
            message: m.message,
            suggestions: m
                .replacements
                .into_iter()
                .map(|r| r.value)
                .filter(|v| !v.is_empty())
                .take(5)
                .collect(),
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::thread;

    /// A LanguageTool stand-in: one request, one canned reply.
    fn serve(body: &'static str) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut request = String::new();
            let mut length = 0usize;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if let Some(value) = line.to_lowercase().strip_prefix("content-length:") {
                    length = value.trim().parse().unwrap_or(0);
                }
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                request.push_str(&line);
            }
            let mut payload = vec![0u8; length];
            reader.read_exact(&mut payload).unwrap();
            stream
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                        body.len(),
                        body
                    )
                    .as_bytes(),
                )
                .unwrap();
            stream.flush().unwrap();
            String::from_utf8_lossy(&payload).into_owned()
        });
        (format!("http://127.0.0.1:{port}/v2/check"), handle)
    }

    #[test]
    fn refuses_anything_but_a_plain_http_endpoint() {
        assert!(validate_endpoint("https://api.languagetool.org/v2/check").is_err());
        assert!(validate_endpoint("ftp://example.com").is_err());
        assert!(validate_endpoint("http://localhost:8081/v2/check").is_ok());
    }

    #[test]
    fn sends_the_paragraph_and_reads_the_matches_back() {
        let (endpoint, server) = serve(
            r#"{"matches":[{"message":"Possible typo","offset":4,"length":6,"replacements":[{"value":"keeper"},{"value":"keepers"}],"rule":{"issueType":"misspelling"}}]}"#,
        );
        let lints = check(&endpoint, "The keper counted waves.", "en-GB").unwrap();
        let sent = server.join().unwrap();
        assert!(sent.contains("language=en-GB"), "sent: {sent}");
        assert!(sent.contains("The+keper"), "sent: {sent}");
        assert_eq!(
            lints,
            vec![GrammarLint {
                start: 4,
                end: 10,
                kind: "misspelling".to_string(),
                message: "Possible typo".to_string(),
                suggestions: vec!["keeper".to_string(), "keepers".to_string()],
            }]
        );
    }

    #[test]
    fn an_unreachable_server_is_an_error_not_a_crash() {
        // Nothing is listening on this port.
        let error = check("http://127.0.0.1:1/v2/check", "text", "en-US").unwrap_err();
        assert_eq!(error.code, "unreachable");
    }
}
