//! Crash reports, with no server and no telemetry (#102): when the user opts
//! in, a crash is written to a file on this machine, and "Send report" opens a
//! prefilled GitHub issue that the user submits themselves.
//!
//! A stub for now: no reports are written, so there are none to list or send,
//! and they can't be turned on yet.

use serde::Serialize;

/// One crash, written locally.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct CrashReport {
    pub id: String,
    /// Unix seconds.
    pub when: u64,
    /// One line on what went wrong.
    pub summary: String,
    /// "Send report" was used on it.
    pub sent: bool,
}

/// The crash reports kept, newest first. Always none for now.
#[tauri::command]
pub fn crash_reports() -> Vec<CrashReport> {
    Vec::new()
}

/// Opens the GitHub issue for report `id`, prefilled for the user to submit. Not there yet: always an error.
#[tauri::command]
pub fn crash_report_open(id: String) -> Result<(), String> {
    let _ = id;
    Err("Sending crash reports comes in 0.9.".into())
}

/// Whether crashes are written down. Always off for now.
#[tauri::command]
pub fn crash_reports_enabled() -> bool {
    false
}

/// Turns writing crashes down on or off. Not there yet: always an error.
#[tauri::command]
pub fn crash_reports_enable(on: bool) -> Result<(), String> {
    let _ = on;
    Err("Crash reports come in 0.9.".into())
}

/// Called first thing in `main`, where the panic hook will go. Does nothing yet.
pub fn install() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn there_are_no_crash_reports_yet() {
        assert!(crash_reports().is_empty());
        assert!(!crash_reports_enabled());
        assert!(crash_reports_enable(true).is_err());
        assert!(crash_report_open("x".into()).is_err());
        let report = CrashReport { id: "a".into(), when: 1, summary: "s".into(), sent: false };
        assert_eq!(serde_json::to_string(&report).unwrap(), r#"{"id":"a","when":1,"summary":"s","sent":false}"#);
    }
}
