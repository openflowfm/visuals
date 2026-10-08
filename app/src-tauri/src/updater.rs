//! Updates: checking for a newer release and installing it, with the Tauri
//! updater. Two channels, chosen when the app is built:
//!
//! - stable (the default) follows tagged releases: `latest.json` on the latest
//!   published release, so a draft goes out only once it is published;
//! - nightly (`VISUALS_CHANNEL=nightly` at build time, which `release.yml`
//!   sets) follows the `nightly` prerelease. Every nightly has the same app
//!   version, so its `latest.json` says `<version>-nightly.<build>` and a
//!   nightly is newer when its build number is (`VISUALS_BUILD`, the run
//!   number, also set by `release.yml`).
//!
//! The page asks on launch and when the menu's "Check for Updates…" fires
//! (`app/src/Update.tsx`); nothing installs without the user saying so.
//!
//! A build without the updater's public key in `tauri.conf.json` (still the
//! placeholder) or a debug build says "Updates aren't set up in this build"
//! and checks nothing.

use serde::Serialize;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

/// What `tauri.conf.json`'s `plugins.updater.pubkey` says until the owner puts
/// the real public key there.
const PLACEHOLDER: &str = "REPLACE_WITH_CONTENTS_OF_visual-flow-updater.key.pub";

/// Where each channel's `latest.json` lives.
const STABLE: &str = "https://github.com/openflowfm/visuals/releases/latest/download/latest.json";
const NIGHTLY: &str = "https://github.com/openflowfm/visuals/releases/download/nightly/latest.json";

/// What the page shows when updates can't be checked in this build.
const NOT_SET_UP: &str = "Updates aren't set up in this build.";

/// A newer release than the one running.
#[derive(Serialize, Clone, Debug)]
pub struct Update {
    version: String,
    /// What changed, as the release says it.
    notes: String,
    /// When it was published, as the release gives it.
    date: Option<String>,
}

/// Which releases this build follows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Channel {
    Stable,
    Nightly,
}

impl Channel {
    /// The channel `VISUALS_CHANNEL` named at build time.
    fn of(name: Option<&str>) -> Channel {
        match name {
            Some("nightly") => Channel::Nightly,
            _ => Channel::Stable,
        }
    }

    fn endpoint(self) -> &'static str {
        match self {
            Channel::Stable => STABLE,
            Channel::Nightly => NIGHTLY,
        }
    }
}

/// This build's channel.
fn channel() -> Channel {
    Channel::of(option_env!("VISUALS_CHANNEL"))
}

/// This build's number (the release run's), if it was built by `release.yml`.
fn build() -> Option<u64> {
    option_env!("VISUALS_BUILD").and_then(|b| b.parse().ok())
}

/// A version as the comparison needs it: major, minor, patch and prerelease.
type Version<'a> = (u64, u64, u64, &'a str);

/// The build number in a nightly's prerelease, `nightly.<build>`.
fn nightly_build(pre: &str) -> Option<u64> {
    pre.strip_prefix("nightly.").and_then(|n| n.parse().ok())
}

/// Whether `remote` is newer than the running `current` on `channel`. Stable
/// compares versions (a prerelease moves on to its release); a nightly is newer
/// when its version's numbers are, or when they are the same and its build is
/// later than this one's.
fn newer(channel: Channel, current: Version, build: Option<u64>, remote: Version) -> bool {
    let (cur, rem) = ((current.0, current.1, current.2), (remote.0, remote.1, remote.2));
    if rem != cur {
        return rem > cur;
    }
    match channel {
        Channel::Stable => !current.3.is_empty() && remote.3.is_empty(),
        Channel::Nightly => match (nightly_build(remote.3), build) {
            (Some(r), Some(b)) => r > b,
            // A nightly built anywhere but the release run has no number to
            // compare with: the published one is the newer.
            (Some(_), None) => true,
            _ => false,
        },
    }
}

/// Whether `pubkey` is a real key rather than the placeholder or nothing.
fn has_key(pubkey: Option<&str>) -> bool {
    pubkey.is_some_and(|k| !k.trim().is_empty() && k != PLACEHOLDER)
}

/// Whether this build can check for updates: a release build whose config has
/// the updater's public key.
fn set_up(app: &tauri::AppHandle) -> bool {
    let pubkey = app.config().plugins.0.get("updater").and_then(|u| u.get("pubkey")).and_then(|k| k.as_str());
    !cfg!(debug_assertions) && has_key(pubkey)
}

/// The update `update_check` last found, for `update_install`.
#[derive(Default)]
struct Found(Mutex<Option<tauri_plugin_updater::Update>>);

/// Set up the updater plugin, when the app starts. Checking is the page's to
/// ask for.
pub fn start(app: tauri::AppHandle) {
    app.manage(Found::default());
    if let Err(e) = app.plugin(tauri_plugin_updater::Builder::new().build()) {
        eprintln!("updates: the updater didn't start: {e}");
    }
}

/// A newer release, if there is one.
#[tauri::command]
pub async fn update_check(app: tauri::AppHandle) -> Result<Option<Update>, String> {
    if !set_up(&app) {
        return Err(NOT_SET_UP.into());
    }
    let channel = channel();
    let failed = |e: tauri_plugin_updater::Error| format!("Couldn't check for updates: {e}");
    let endpoint = channel.endpoint().parse().map_err(|e| format!("Couldn't check for updates: {e}"))?;
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(failed)?
        .version_comparator(move |current, remote| {
            let v = &remote.version;
            newer(channel, (current.major, current.minor, current.patch, current.pre.as_str()), build(), (v.major, v.minor, v.patch, v.pre.as_str()))
        })
        .build()
        .map_err(failed)?;
    let found = updater.check().await.map_err(failed)?;
    let shown = found.as_ref().map(|u| Update { version: u.version.clone(), notes: u.body.clone().unwrap_or_default(), date: u.date.map(|d| d.to_string()) });
    *app.state::<Found>().0.lock().unwrap() = found;
    Ok(shown)
}

/// Download and install the newer release, then restart into it.
#[tauri::command]
pub async fn update_install(app: tauri::AppHandle) -> Result<(), String> {
    let update = app.state::<Found>().0.lock().unwrap().clone().ok_or("no update to install")?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| format!("Couldn't install the update: {e}"))?;
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_channel_is_stable_unless_named_nightly() {
        assert_eq!(Channel::of(None), Channel::Stable);
        assert_eq!(Channel::of(Some("stable")), Channel::Stable);
        assert_eq!(Channel::of(Some("nightly")), Channel::Nightly);
        assert_eq!(Channel::Stable.endpoint(), STABLE);
        assert_eq!(Channel::Nightly.endpoint(), NIGHTLY);
    }

    #[test]
    fn stable_offers_only_a_later_version() {
        let s = Channel::Stable;
        assert!(newer(s, (0, 3, 0, ""), None, (0, 3, 1, "")));
        assert!(newer(s, (0, 3, 0, ""), None, (1, 0, 0, "")));
        assert!(!newer(s, (0, 3, 0, ""), None, (0, 3, 0, "")));
        assert!(!newer(s, (0, 3, 1, ""), None, (0, 3, 0, "")));
        // A release candidate moves on to its release, never the other way.
        assert!(newer(s, (0, 3, 0, "rc.1"), None, (0, 3, 0, "")));
        assert!(!newer(s, (0, 3, 0, ""), None, (0, 3, 0, "rc.1")));
    }

    #[test]
    fn nightly_offers_a_later_build() {
        let n = Channel::Nightly;
        assert!(newer(n, (0, 3, 0, ""), Some(120), (0, 3, 0, "nightly.121")));
        assert!(!newer(n, (0, 3, 0, ""), Some(121), (0, 3, 0, "nightly.121")));
        assert!(!newer(n, (0, 3, 0, ""), Some(122), (0, 3, 0, "nightly.121")));
        // Build numbers are compared as numbers, not text.
        assert!(newer(n, (0, 3, 0, ""), Some(99), (0, 3, 0, "nightly.100")));
    }

    #[test]
    fn nightly_follows_the_version_when_it_moves() {
        let n = Channel::Nightly;
        assert!(newer(n, (0, 3, 0, ""), Some(200), (0, 4, 0, "nightly.150")));
        assert!(!newer(n, (0, 4, 0, ""), Some(100), (0, 3, 0, "nightly.150")));
    }

    #[test]
    fn a_nightly_without_a_build_number_takes_the_published_one() {
        assert!(newer(Channel::Nightly, (0, 3, 0, ""), None, (0, 3, 0, "nightly.5")));
        assert!(!newer(Channel::Nightly, (0, 3, 0, ""), Some(5), (0, 3, 0, "")));
    }

    #[test]
    fn the_placeholder_key_is_no_key() {
        assert!(!has_key(None));
        assert!(!has_key(Some("")));
        assert!(!has_key(Some(PLACEHOLDER)));
        assert!(has_key(Some("dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk=")));
    }

    /// The placeholder here and in `tauri.conf.json` must be the same text, or
    /// a build without the key would think it has one; the config's endpoint
    /// is stable's, which nightly builds replace.
    #[test]
    fn the_config_holds_the_placeholder_and_the_stable_endpoint() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let updater = &conf["plugins"]["updater"];
        let pubkey = updater["pubkey"].as_str().expect("plugins.updater.pubkey");
        if pubkey.starts_with("REPLACE_WITH") {
            assert_eq!(pubkey, PLACEHOLDER);
        }
        assert_eq!(updater["endpoints"][0].as_str(), Some(STABLE));
        // The plugin reads it at start; a config it can't read means no updater.
        let read: tauri_plugin_updater::Config = serde_json::from_value(updater.clone()).expect("the updater plugin reads its config");
        assert_eq!(read.endpoints.len(), 1);
        assert_eq!(conf["bundle"]["createUpdaterArtifacts"], serde_json::Value::Null, "release.yml turns update bundles on only when it has the key");
    }
}
