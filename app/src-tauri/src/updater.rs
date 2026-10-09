//! Updates: checking for a newer release and installing it, with the Tauri
//! updater. Three channels, chosen when the app is built (`VISUALS_CHANNEL`,
//! which `release.yml` sets; see `docs/releasing.md`):
//!
//! - stable (the default, and any name it doesn't know) follows final
//!   releases: `latest.json` on the latest published release, so a draft goes
//!   out only once it is published. It never offers a prerelease;
//! - beta follows the fixed `beta` prerelease, whose `latest.json` names each
//!   release candidate and each final once published, compared as versions:
//!   `1.0.0-rc.2` moves on to `1.0.0-rc.3`, then to `1.0.0`;
//! - latest follows the fixed `latest` prerelease, rebuilt on every push to
//!   `main`. Every latest build has the same app version, so its
//!   `latest.json` says `<version>-latest.<build>` and a build is newer when
//!   its build number is (`VISUALS_BUILD`, the run number, also set by
//!   `release.yml`).
//!
//! The page asks on launch and when the menu's "Check for Updates…" fires
//! (`app/src/Update.tsx`); nothing installs without the user saying so.
//!
//! A build without the updater's public key in `tauri.conf.json` (still the
//! placeholder) or a debug build says "Updates aren't set up in this build"
//! and checks nothing.

use serde::Serialize;
use std::cmp::Ordering;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

/// What `tauri.conf.json`'s `plugins.updater.pubkey` says until the owner puts
/// the real public key there.
const PLACEHOLDER: &str = "REPLACE_WITH_CONTENTS_OF_visual-flow-updater.key.pub";

/// Where each channel's `latest.json` lives.
const STABLE: &str = "https://github.com/openflowfm/visuals/releases/latest/download/latest.json";
const BETA: &str = "https://github.com/openflowfm/visuals/releases/download/beta/latest.json";
const LATEST: &str = "https://github.com/openflowfm/visuals/releases/download/latest/latest.json";

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
    Beta,
    Latest,
}

impl Channel {
    /// The channel `VISUALS_CHANNEL` named at build time; stable when it named
    /// none or one this build doesn't know.
    fn of(name: Option<&str>) -> Channel {
        match name {
            Some("beta") => Channel::Beta,
            Some("latest") => Channel::Latest,
            _ => Channel::Stable,
        }
    }

    fn endpoint(self) -> &'static str {
        match self {
            Channel::Stable => STABLE,
            Channel::Beta => BETA,
            Channel::Latest => LATEST,
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

/// The build number in a latest build's prerelease, `latest.<build>`.
fn latest_build(pre: &str) -> Option<u64> {
    pre.strip_prefix("latest.").and_then(|n| n.parse().ok())
}

/// How two prereleases order, as semver orders them: none (a release) comes
/// after any; otherwise part by part, numbers as numbers and before words, and
/// a shorter one first when the other goes on from it (`rc.2` < `rc.10`).
fn prerelease_order(a: &str, b: &str) -> Ordering {
    match (a.is_empty(), b.is_empty()) {
        (true, true) => return Ordering::Equal,
        (true, false) => return Ordering::Greater,
        (false, true) => return Ordering::Less,
        _ => {}
    }
    let (mut a, mut b) = (a.split('.'), b.split('.'));
    loop {
        let part = match (a.next(), b.next()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(x), Some(y)) => match (x.parse::<u64>(), y.parse::<u64>()) {
                (Ok(x), Ok(y)) => x.cmp(&y),
                (Ok(_), Err(_)) => Ordering::Less,
                (Err(_), Ok(_)) => Ordering::Greater,
                (Err(_), Err(_)) => x.cmp(y),
            },
        };
        if part != Ordering::Equal {
            return part;
        }
    }
}

/// How two versions order: their numbers, then their prereleases.
fn version_order(a: Version, b: Version) -> Ordering {
    (a.0, a.1, a.2).cmp(&(b.0, b.1, b.2)).then_with(|| prerelease_order(a.3, b.3))
}

/// Whether `remote` is newer than the running `current` on `channel`.
///
/// - Stable offers only a release (never a prerelease) of a later version.
/// - Beta offers any later version: the next release candidate, then the
///   release it leads to.
/// - Latest offers a build whose version's numbers are later, or the same
///   with a later build than this one's.
fn newer(channel: Channel, current: Version, build: Option<u64>, remote: Version) -> bool {
    match channel {
        Channel::Stable => remote.3.is_empty() && version_order(current, remote) == Ordering::Less,
        Channel::Beta => version_order(current, remote) == Ordering::Less,
        Channel::Latest => {
            let (cur, rem) = ((current.0, current.1, current.2), (remote.0, remote.1, remote.2));
            if rem != cur {
                return rem > cur;
            }
            match (latest_build(remote.3), build) {
                (Some(r), Some(b)) => r > b,
                // A latest build made anywhere but the release run has no
                // number to compare with: the published one is the newer.
                (Some(_), None) => true,
                _ => false,
            }
        }
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
    fn the_channel_is_stable_unless_named_beta_or_latest() {
        assert_eq!(Channel::of(None), Channel::Stable);
        assert_eq!(Channel::of(Some("stable")), Channel::Stable);
        assert_eq!(Channel::of(Some("beta")), Channel::Beta);
        assert_eq!(Channel::of(Some("latest")), Channel::Latest);
        // The old nightly, a typo or anything else: stable.
        assert_eq!(Channel::of(Some("nightly")), Channel::Stable);
        assert_eq!(Channel::of(Some("Beta")), Channel::Stable);
        assert_eq!(Channel::of(Some("")), Channel::Stable);
        assert_eq!(Channel::Stable.endpoint(), STABLE);
        assert_eq!(Channel::Beta.endpoint(), BETA);
        assert_eq!(Channel::Latest.endpoint(), LATEST);
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
    fn stable_never_sees_a_prerelease() {
        let s = Channel::Stable;
        assert!(!newer(s, (1, 0, 0, ""), None, (1, 1, 0, "rc.1")));
        assert!(!newer(s, (1, 0, 0, ""), None, (2, 0, 0, "rc.1")));
        assert!(!newer(s, (1, 0, 0, ""), Some(5), (1, 0, 1, "latest.900")));
    }

    #[test]
    fn beta_moves_through_the_candidates_to_the_release() {
        let b = Channel::Beta;
        assert!(newer(b, (1, 0, 0, "rc.2"), None, (1, 0, 0, "rc.3")));
        assert!(newer(b, (1, 0, 0, "rc.3"), None, (1, 0, 0, "")));
        assert!(newer(b, (1, 0, 0, "rc.2"), None, (1, 0, 0, "")));
        assert!(!newer(b, (1, 0, 0, "rc.3"), None, (1, 0, 0, "rc.3")));
        assert!(!newer(b, (1, 0, 0, "rc.3"), None, (1, 0, 0, "rc.2")));
        assert!(!newer(b, (1, 0, 0, ""), None, (1, 0, 0, "rc.3")));
        // Candidate numbers are compared as numbers, not text.
        assert!(newer(b, (1, 0, 0, "rc.9"), None, (1, 0, 0, "rc.10")));
        // After a release, the next one's candidates.
        assert!(newer(b, (1, 0, 0, ""), None, (1, 0, 1, "rc.1")));
        assert!(newer(b, (1, 0, 0, ""), None, (1, 1, 0, "rc.1")));
        assert!(!newer(b, (1, 1, 0, "rc.1"), None, (1, 0, 1, "")));
    }

    #[test]
    fn prereleases_order_as_semver_does() {
        use Ordering::*;
        assert_eq!(prerelease_order("", ""), Equal);
        assert_eq!(prerelease_order("rc.1", ""), Less);
        assert_eq!(prerelease_order("", "rc.1"), Greater);
        assert_eq!(prerelease_order("rc.2", "rc.10"), Less);
        assert_eq!(prerelease_order("rc", "rc.1"), Less);
        assert_eq!(prerelease_order("1", "rc"), Less);
        assert_eq!(prerelease_order("beta.2", "rc.1"), Less);
        assert_eq!(version_order((1, 0, 0, "rc.5"), (0, 9, 9, "")), Greater);
    }

    #[test]
    fn latest_offers_a_later_build() {
        let l = Channel::Latest;
        assert!(newer(l, (0, 3, 0, ""), Some(120), (0, 3, 0, "latest.121")));
        assert!(!newer(l, (0, 3, 0, ""), Some(121), (0, 3, 0, "latest.121")));
        assert!(!newer(l, (0, 3, 0, ""), Some(122), (0, 3, 0, "latest.121")));
        // Build numbers are compared as numbers, not text.
        assert!(newer(l, (0, 3, 0, ""), Some(99), (0, 3, 0, "latest.100")));
    }

    #[test]
    fn latest_follows_the_version_when_it_moves() {
        let l = Channel::Latest;
        assert!(newer(l, (0, 3, 0, ""), Some(200), (0, 4, 0, "latest.150")));
        assert!(!newer(l, (0, 4, 0, ""), Some(100), (0, 3, 0, "latest.150")));
    }

    #[test]
    fn a_latest_build_without_a_build_number_takes_the_published_one() {
        assert!(newer(Channel::Latest, (0, 3, 0, ""), None, (0, 3, 0, "latest.5")));
        assert!(!newer(Channel::Latest, (0, 3, 0, ""), Some(5), (0, 3, 0, "")));
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
    /// is stable's, which beta and latest builds replace.
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
