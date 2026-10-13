//! Updates: checking for a newer version and installing it, with the Tauri
//! updater. Two channels (see `docs/releasing.md`), and the app follows the one
//! chosen in Settings, kept in `updates.json`:
//!
//! - release follows final releases: `latest.json` on GitHub's latest release,
//!   which is never a draft or a prerelease, so it moves only when a `vX.Y.Z`
//!   tag's draft is published. It never offers a prerelease;
//! - latest follows the fixed `latest` prerelease, rebuilt on every push to
//!   `main`. Every latest build has the app version in `tauri.conf.json`, so
//!   its `latest.json` says `<version>-latest.<build>` and a build is newer when
//!   its numbers are later, or the same with a later build than this one's
//!   (`VISUALS_BUILD`, the release run's number, which `release.yml` compiles
//!   into every build, tagged ones too, so the numbers are one sequence).
//!
//! Until a choice is made the channel is the build's own: latest for a build
//! from `main` (`VISUALS_CHANNEL=latest`, set by `release.yml`), release for any
//! other. The page asks on launch and when the menu's "Check for Updates…"
//! fires; nothing installs without the user saying so.
//!
//! A build without the updater's public key in `tauri.conf.json` (still the
//! placeholder) or a debug build says "Updates aren't set up in this build"
//! and checks nothing; the channel can still be chosen and is kept.

use crate::settings;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

/// What `tauri.conf.json`'s `plugins.updater.pubkey` says until the owner puts
/// the real public key there.
const PLACEHOLDER: &str = "REPLACE_WITH_CONTENTS_OF_visual-flow-updater.key.pub";

/// Where each channel's `latest.json` lives.
const RELEASE: &str = "https://github.com/openflowfm/visuals/releases/latest/download/latest.json";
const LATEST: &str = "https://github.com/openflowfm/visuals/releases/download/latest/latest.json";

/// Where the chosen channel is kept, in [`settings::dir`].
const FILE: &str = "updates.json";

/// What the page shows when updates can't be checked in this build.
const NOT_SET_UP: &str = "Updates aren't set up in this build.";

/// What [`update_channel_set`] says when the choice couldn't be kept.
const NOT_KEPT: &str = "Couldn't save the update channel; it is followed until visual[flow] quits.";

/// A newer release than the one running.
#[derive(Serialize, Clone, Debug)]
pub struct Update {
    version: String,
    /// What changed, as the release says it.
    notes: String,
    /// When it was published, as the release gives it.
    date: Option<String>,
}

/// Which releases the app follows (`api.UpdateChannel`).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Release,
    Latest,
}

impl Channel {
    /// The channel a build follows until one is chosen, from the
    /// `VISUALS_CHANNEL` it was built with: latest for `latest`, release for
    /// none or anything else (the old `stable` and `beta` among them).
    fn of_build(name: Option<&str>) -> Channel {
        match name {
            Some("latest") => Channel::Latest,
            _ => Channel::Release,
        }
    }

    fn endpoint(self) -> &'static str {
        match self {
            Channel::Release => RELEASE,
            Channel::Latest => LATEST,
        }
    }
}

/// This build's own channel.
fn built() -> Channel {
    Channel::of_build(option_env!("VISUALS_CHANNEL"))
}

/// What's kept in [`FILE`].
#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct Kept {
    channel: Channel,
}

/// The channel to follow: the one kept, or the build's own when none is (no
/// file, or one that couldn't be read, which `settings` moves aside and says).
fn chosen(kept: Option<Kept>, built: Channel) -> Channel {
    kept.map_or(built, |k| k.channel)
}

/// The channel followed, as the page reads it (`api.UpdateChannels`).
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
pub struct Channels {
    /// Followed now.
    channel: Channel,
    /// This build's own, followed until one is chosen.
    default: Channel,
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

/// Whether `remote` is newer than the running `current` (whose build number
/// is `build`) on `channel`. The running app may have been built for the other
/// channel: a release app switched to latest, or the other way.
///
/// - Release offers only a release (never a prerelease) of a later version: a
///   release candidate moves on to its release.
/// - Latest offers a build whose version's numbers are later, or the same
///   with a later build than this one's.
fn newer(channel: Channel, current: Version, build: Option<u64>, remote: Version) -> bool {
    match channel {
        Channel::Release => remote.3.is_empty() && version_order(current, remote) == Ordering::Less,
        Channel::Latest => {
            let (cur, rem) = ((current.0, current.1, current.2), (remote.0, remote.1, remote.2));
            if rem != cur {
                return rem > cur;
            }
            match (latest_build(remote.3), build) {
                (Some(r), Some(b)) => r > b,
                // A build made anywhere but the release run has no number to
                // compare with: the published one is the newer.
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

/// The channel followed now. Its lock is held while [`FILE`] is written, so
/// the file ends with the channel followed.
struct Following(Mutex<Channel>);

/// Set up the updater plugin and read the kept channel, when the app starts.
/// Checking is the page's to ask for.
pub fn start(app: tauri::AppHandle) {
    app.manage(Found::default());
    app.manage(Following(Mutex::new(chosen(settings::load::<Kept>(FILE), built()))));
    if let Err(e) = app.plugin(tauri_plugin_updater::Builder::new().build()) {
        eprintln!("updates: the updater didn't start: {e}");
    }
}

fn following(app: &tauri::AppHandle) -> Channel {
    *app.state::<Following>().0.lock().unwrap_or_else(|e| e.into_inner())
}

/// The channel followed, and this build's own.
#[tauri::command]
pub fn update_channel(app: tauri::AppHandle) -> Channels {
    Channels { channel: following(&app), default: built() }
}

/// Follow `channel` from now on, kept for next launch. It is followed at once
/// either way; if it couldn't be kept, the error says so (and the settings'
/// problems too). An update found on the channel before is forgotten.
#[tauri::command]
pub fn update_channel_set(app: tauri::AppHandle, channel: Channel) -> Result<Channels, String> {
    let kept = {
        let state = app.state::<Following>();
        let mut now = state.0.lock().unwrap_or_else(|e| e.into_inner());
        *now = channel;
        *app.state::<Found>().0.lock().unwrap_or_else(|e| e.into_inner()) = None;
        settings::save_json(FILE, &Kept { channel })
    };
    if !kept {
        return Err(NOT_KEPT.into());
    }
    Ok(Channels { channel, default: built() })
}

/// A newer version on the channel followed, if there is one.
#[tauri::command]
pub async fn update_check(app: tauri::AppHandle) -> Result<Option<Update>, String> {
    if !set_up(&app) {
        return Err(NOT_SET_UP.into());
    }
    let channel = following(&app);
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
    // Under the channel's lock, so a change of channel can't come between
    // the look and keeping what was found.
    let state = app.state::<Following>();
    let now = state.0.lock().unwrap_or_else(|e| e.into_inner());
    if *now != channel {
        // The channel changed while checking: what was found is the old one's.
        return Ok(None);
    }
    let shown = found.as_ref().map(|u| Update { version: u.version.clone(), notes: u.body.clone().unwrap_or_default(), date: u.date.map(|d| d.to_string()) });
    *app.state::<Found>().0.lock().unwrap_or_else(|e| e.into_inner()) = found;
    drop(now);
    Ok(shown)
}

/// Download and install the newer release, then restart into it.
#[tauri::command]
pub async fn update_install(app: tauri::AppHandle) -> Result<(), String> {
    let update = app.state::<Found>().0.lock().unwrap_or_else(|e| e.into_inner()).clone().ok_or("no update to install")?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| format!("Couldn't install the update: {e}"))?;
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_build_follows_latest_only_when_built_from_main() {
        assert_eq!(Channel::of_build(None), Channel::Release);
        assert_eq!(Channel::of_build(Some("release")), Channel::Release);
        assert_eq!(Channel::of_build(Some("latest")), Channel::Latest);
        // The old stable and beta, a typo or anything else: release.
        assert_eq!(Channel::of_build(Some("stable")), Channel::Release);
        assert_eq!(Channel::of_build(Some("beta")), Channel::Release);
        assert_eq!(Channel::of_build(Some("Latest")), Channel::Release);
        assert_eq!(Channel::of_build(Some("")), Channel::Release);
    }

    #[test]
    fn each_channel_reads_its_own_manifest() {
        assert_eq!(Channel::Release.endpoint(), RELEASE);
        assert_eq!(Channel::Latest.endpoint(), LATEST);
        assert_ne!(RELEASE, LATEST);
    }

    #[test]
    fn the_kept_channel_wins_over_the_builds_own() {
        assert_eq!(chosen(Some(Kept { channel: Channel::Latest }), Channel::Release), Channel::Latest);
        assert_eq!(chosen(Some(Kept { channel: Channel::Release }), Channel::Latest), Channel::Release);
        assert_eq!(chosen(None, Channel::Latest), Channel::Latest, "nothing kept: the build's own");
        assert_eq!(chosen(None, Channel::Release), Channel::Release);
    }

    #[test]
    fn the_kept_channel_reads_back_and_a_bad_one_doesnt() {
        let json = serde_json::to_string(&Kept { channel: Channel::Latest }).unwrap();
        assert_eq!(json, r#"{"channel":"latest"}"#);
        assert_eq!(serde_json::from_str::<Kept>(&json).unwrap(), Kept { channel: Channel::Latest });
        // The versioned file settings writes reads too.
        assert_eq!(serde_json::from_str::<Kept>(r#"{"version":1,"channel":"release"}"#).unwrap(), Kept { channel: Channel::Release });
        // A channel this build doesn't know isn't a choice: settings moves it aside.
        assert!(serde_json::from_str::<Kept>(r#"{"channel":"beta"}"#).is_err());
        assert!(serde_json::from_str::<Kept>(r#"{}"#).is_err());
    }

    #[test]
    fn the_page_reads_the_channels_as_it_expects() {
        let c = Channels { channel: Channel::Latest, default: Channel::Release };
        assert_eq!(serde_json::to_string(&c).unwrap(), r#"{"channel":"latest","default":"release"}"#);
        assert_eq!(serde_json::from_str::<Channel>(r#""release""#).unwrap(), Channel::Release);
    }

    #[test]
    fn release_offers_only_a_later_version() {
        let r = Channel::Release;
        assert!(newer(r, (0, 3, 0, ""), None, (0, 3, 1, "")));
        assert!(newer(r, (0, 3, 0, ""), None, (1, 0, 0, "")));
        assert!(!newer(r, (0, 3, 0, ""), None, (0, 3, 0, "")));
        assert!(!newer(r, (0, 3, 1, ""), None, (0, 3, 0, "")));
        // A release candidate moves on to its release, never the other way.
        assert!(newer(r, (0, 3, 0, "rc.1"), None, (0, 3, 0, "")));
        assert!(!newer(r, (0, 3, 0, ""), None, (0, 3, 0, "rc.1")));
    }

    #[test]
    fn release_never_sees_a_prerelease_or_a_latest_build() {
        let r = Channel::Release;
        assert!(!newer(r, (1, 0, 0, ""), None, (1, 1, 0, "rc.1")));
        assert!(!newer(r, (1, 0, 0, ""), None, (2, 0, 0, "rc.1")));
        assert!(!newer(r, (1, 0, 0, ""), Some(5), (1, 0, 1, "latest.900")));
    }

    #[test]
    fn a_latest_app_switched_to_release_waits_for_the_next_release() {
        // A latest build of 0.3.0 (build 600): the 0.3.0 release isn't newer, 0.3.1 is.
        let r = Channel::Release;
        assert!(!newer(r, (0, 3, 0, ""), Some(600), (0, 3, 0, "")));
        assert!(!newer(r, (0, 3, 0, ""), Some(600), (0, 2, 9, "")));
        assert!(newer(r, (0, 3, 0, ""), Some(600), (0, 3, 1, "")));
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
    fn a_release_app_switched_to_latest_takes_a_build_after_its_own() {
        // The 0.3.0 release was run 500; main's builds of 0.3.0 after it are newer, before it aren't.
        let l = Channel::Latest;
        assert!(newer(l, (0, 3, 0, ""), Some(500), (0, 3, 0, "latest.510")));
        assert!(!newer(l, (0, 3, 0, ""), Some(500), (0, 3, 0, "latest.490")));
        // main has moved on to 0.4.0: any of its builds.
        assert!(newer(l, (0, 3, 0, ""), Some(500), (0, 4, 0, "latest.501")));
        // A release candidate's app moves onto a later build of its version.
        assert!(newer(l, (1, 0, 0, "rc.1"), Some(700), (1, 0, 0, "latest.701")));
    }

    #[test]
    fn a_latest_build_without_a_build_number_takes_the_published_one() {
        assert!(newer(Channel::Latest, (0, 3, 0, ""), None, (0, 3, 0, "latest.5")));
        assert!(!newer(Channel::Latest, (0, 3, 0, ""), Some(5), (0, 3, 0, "")));
    }

    /// The manifest as `release.yml` writes it (`latest.json`, one platform),
    /// read by the updater plugin itself: the latest scheme's version is a
    /// semver prerelease whose parts reach the comparison as [`newer`] wants.
    #[test]
    fn the_manifest_release_yml_writes_reads_in_the_updater() {
        let json = r#"{"version":"0.3.0-latest.121","notes":"Latest build 121","pub_date":"2026-10-13T12:00:00Z",
            "platforms":{"darwin-aarch64":{"signature":"c2ln","url":"https://github.com/openflowfm/visuals/releases/download/latest/visual-flow-latest-121_aarch64.app.tar.gz"}}}"#;
        let release: tauri_plugin_updater::RemoteRelease = serde_json::from_str(json).expect("the updater reads latest.json");
        let v = &release.version;
        assert_eq!((v.major, v.minor, v.patch, v.pre.as_str()), (0, 3, 0, "latest.121"));
        assert_eq!(latest_build(v.pre.as_str()), Some(121));
        assert!(release.download_url("darwin-aarch64").is_ok());
        assert!(newer(Channel::Latest, (0, 3, 0, ""), Some(120), (v.major, v.minor, v.patch, v.pre.as_str())));
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
    /// is release's, which [`update_check`] replaces with the channel's own.
    #[test]
    fn the_config_holds_the_placeholder_and_the_release_endpoint() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let updater = &conf["plugins"]["updater"];
        let pubkey = updater["pubkey"].as_str().expect("plugins.updater.pubkey");
        if pubkey.starts_with("REPLACE_WITH") {
            assert_eq!(pubkey, PLACEHOLDER);
        }
        assert_eq!(updater["endpoints"][0].as_str(), Some(RELEASE));
        // The plugin reads it at start; a config it can't read means no updater.
        let read: tauri_plugin_updater::Config = serde_json::from_value(updater.clone()).expect("the updater plugin reads its config");
        assert_eq!(read.endpoints.len(), 1);
        assert_eq!(conf["bundle"]["createUpdaterArtifacts"], serde_json::Value::Null, "release.yml turns update bundles on only when it has the key");
    }
}
