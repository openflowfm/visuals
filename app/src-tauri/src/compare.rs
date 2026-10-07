//! The compare view's half in the app: Butterchurn (in the page) and the engine
//! (the native bench) playing the same preset to the same live audio, and the
//! verdicts Ryan gives them.
//!
//! - **Verdicts** go to the same file, in the same shape, as the recorded bench's
//!   (`harness/compare.ts`, `harness/compareReport.ts`): `approvals.json` under
//!   `$OPENFLOW_HOME/visuals/compare/` (`~/.openflow` without it), keyed by the
//!   preset's path in the pack, sorted, one-space indented.
//! - **Audio**: the page polls [`compare_audio`] once an animation frame for the
//!   windows the bench reads, as the bytes Butterchurn's `audioLevels` takes.
//! - **Conversion** of `.milk` to Butterchurn's JSON runs in the page; the results
//!   share the recorded bench's cache, `<pack>/.converted/<converter>/<sha256>.json`.

use crate::{App, Opened};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use tauri::State;

/// The seed presets open with here: the recorded bench's default (`--seed 1`), so
/// `rand_start`, `rand_preset` and the init equations start alike on both sides.
pub const SEED: u64 = 1;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    Approve,
    Reject,
}

/// One preset's verdict: `compareReport.ts`'s `Approval`, field for field. Fields
/// this does not know are kept as they were.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Approval {
    #[serde(default)]
    pub verdict: Option<Verdict>,
    #[serde(default)]
    pub note: String,
    /// The recorded bench's score when the verdict was given. A verdict given here
    /// keeps the score that was there; the live view has none of its own.
    #[serde(default)]
    pub score: Option<f64>,
    #[serde(default)]
    pub at: String,
    #[serde(flatten)]
    pub other: serde_json::Map<String, serde_json::Value>,
}

pub type Approvals = BTreeMap<String, Approval>;

pub fn approvals_file() -> PathBuf {
    std::env::var_os("OPENFLOW_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".openflow"))
        .join("visuals")
        .join("compare")
        .join("approvals.json")
}

/// Every verdict in `file`; none when there is no file. A file that will not
/// parse is an error, so a save never writes over verdicts it could not read.
pub fn read(file: &Path) -> Result<Approvals, String> {
    match std::fs::read_to_string(file) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("{} will not parse: {e}", file.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Approvals::new()),
        Err(e) => Err(e.to_string()),
    }
}

/// Written as the recorded bench writes it: `JSON.stringify(sorted, null, 1)`, a
/// newline, through a temporary file.
pub fn write(file: &Path, all: &Approvals) -> Result<(), String> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut out = Vec::new();
    let mut serializer = serde_json::Serializer::with_formatter(&mut out, serde_json::ser::PrettyFormatter::with_indent(b" "));
    all.serialize(&mut serializer).map_err(|e| e.to_string())?;
    out.push(b'\n');
    let tmp = file.with_extension("json.tmp");
    std::fs::write(&tmp, out).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, file).map_err(|e| e.to_string())
}

/// Give `id` a verdict and note, as the recorded bench's page does: neither one
/// removes the entry. Returns what is kept.
pub fn judge(all: &mut Approvals, id: &str, verdict: Option<Verdict>, note: &str, at: String) -> Option<Approval> {
    let note = note.trim();
    if verdict.is_none() && note.is_empty() {
        all.remove(id);
        return None;
    }
    let before = all.remove(id);
    let entry = Approval {
        verdict,
        note: note.to_owned(),
        score: before.as_ref().and_then(|b| b.score),
        at,
        other: before.map(|b| b.other).unwrap_or_default(),
    };
    all.insert(id.to_owned(), entry.clone());
    Some(entry)
}

/// What approvals are keyed by: the path in the pack, `/`-separated; the whole
/// path for a preset outside it.
pub fn id_of(library: &Path, path: &Path) -> String {
    match path.strip_prefix(library) {
        Ok(rel) => rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"),
        Err(_) => path.to_string_lossy().into_owned(),
    }
}

/// `Date.prototype.toISOString` for a moment `ms` milliseconds after 1970.
pub fn iso(ms: u64) -> String {
    let (secs, millis) = (ms / 1000, ms % 1000);
    let (days, rest) = ((secs / 86_400) as i64, secs % 86_400);
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z", rest / 3600, rest / 60 % 60, rest % 60)
}

fn now() -> String {
    iso(std::time::UNIX_EPOCH.elapsed().map(|d| d.as_millis() as u64).unwrap_or(0))
}

/// The pack's presets, found as the recorded bench finds them: through real
/// folders only (the pack also links its categories at the top), no dot files.
fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let Ok(kind) = entry.file_type() else { continue };
        let path = entry.path();
        if kind.is_dir() {
            walk(&path, out);
        } else if kind.is_file() && path.extension().is_some_and(|e| e.eq_ignore_ascii_case("milk")) {
            out.push(path);
        }
    }
}

#[derive(Serialize)]
pub struct Listed {
    path: String,
    name: String,
    group: String,
    /// The approvals key.
    id: String,
}

#[tauri::command]
pub fn compare_presets(app: State<App>) -> Vec<Listed> {
    let mut files = Vec::new();
    walk(&app.library, &mut files);
    files.sort();
    files
        .into_iter()
        .map(|p| Listed {
            name: p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
            group: p.parent().and_then(|d| d.strip_prefix(&app.library).ok()).map(|d| d.to_string_lossy().into_owned()).unwrap_or_default(),
            id: id_of(&app.library, &p),
            path: p.to_string_lossy().into_owned(),
        })
        .collect()
}

#[derive(Serialize)]
pub struct Book {
    file: String,
    items: Approvals,
}

#[tauri::command]
pub fn compare_approvals() -> Result<Book, String> {
    let file = approvals_file();
    Ok(Book { items: read(&file)?, file: file.to_string_lossy().into_owned() })
}

/// Save one preset's verdict and note; read, changed and written at once, so the
/// recorded bench's page can save to the same file in between.
#[tauri::command]
pub fn compare_judge(id: String, verdict: Option<Verdict>, note: String) -> Result<Option<Approval>, String> {
    if id.is_empty() {
        return Err("no preset".into());
    }
    let file = approvals_file();
    let mut all = read(&file)?;
    let kept = judge(&mut all, &id, verdict, &note, now());
    write(&file, &all)?;
    Ok(kept)
}

/// Open `path` on the bench with [`SEED`].
#[tauri::command]
pub async fn compare_open(path: String, app: State<'_, App>, deck: State<'_, crate::actions::Deck>) -> Result<Opened, String> {
    deck.opened(Path::new(&path));
    let text = engine::preset::decode(&std::fs::read(&path).map_err(|e| e.to_string())?);
    let preset = engine::preset::parse(&text);
    app.seed.store(SEED, Ordering::Relaxed);
    let report = crate::load(&app, preset.clone())?;
    Ok(Opened { preset, report })
}

/// The windows the bench hears, as Butterchurn takes them: the input's sample rate
/// (f32, little-endian; 0 when nothing is listening), then `timeByteArray`,
/// `timeByteArrayL` and `timeByteArrayR`, 1024 bytes each. Converted as
/// `engine::audio::Audio::update` converts them.
#[tauri::command]
pub fn compare_audio(app: State<App>) -> tauri::ipc::Response {
    let rate = app.listening.lock().unwrap().as_ref().map(|l| l.rate).unwrap_or(0.0);
    let (left, right): (Vec<f32>, Vec<f32>) = {
        let ring = app.ring.lock().unwrap();
        (ring.0.iter().copied().collect(), ring.1.iter().copied().collect())
    };
    tauri::ipc::Response::new(levels(rate, &left, &right))
}

pub fn levels(rate: f32, left: &[f32], right: &[f32]) -> Vec<u8> {
    const N: usize = crate::listen::WINDOW;
    let byte = |v: f32| (128.0 + v.clamp(-1.0, 1.0) * 127.0).round().clamp(0.0, 255.0) as u8;
    let mut out = vec![128u8; 4 + 3 * N];
    out[..4].copy_from_slice(&rate.to_le_bytes());
    let n = left.len().min(right.len()).min(N);
    let at = N - n;
    for i in 0..n {
        let (l, r) = (left[left.len() - n + i], right[right.len() - n + i]);
        out[4 + at + i] = byte((l + r) * 0.5);
        out[4 + N + at + i] = byte(l);
        out[4 + 2 * N + at + i] = byte(r);
    }
    out
}

/// A preset's bytes, for the page's converter.
#[tauri::command]
pub fn compare_source(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(&path).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

/// One file name part of the cache: no separators, nothing hidden.
fn plain(part: &str) -> Result<&str, String> {
    let ok = !part.is_empty()
        && !part.starts_with('.')
        && part.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '@' | '-' | '_'));
    if ok { Ok(part) } else { Err(format!("not a cache name: {part}")) }
}

fn cache_file(library: &Path, converter: &str, hash: &str) -> Result<PathBuf, String> {
    Ok(library.join(".converted").join(plain(converter)?).join(format!("{}.json", plain(hash)?)))
}

#[tauri::command]
pub fn compare_cached(converter: String, hash: String, app: State<App>) -> Result<Option<String>, String> {
    Ok(std::fs::read_to_string(cache_file(&app.library, &converter, &hash)?).ok())
}

#[tauri::command]
pub fn compare_cache(converter: String, hash: String, json: String, app: State<App>) -> Result<(), String> {
    let file = cache_file(&app.library, &converter, &hash)?;
    std::fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = file.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &file).map_err(|e| e.to_string())
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Start {
    /// Open in the compare view: `VISUALS_COMPARE=1`.
    compare: bool,
    /// The preset to open first: `VISUALS_PRESET=<path>`, absolute or in the pack.
    preset: Option<String>,
}

fn start_from(compare: Option<String>, preset: Option<String>, library: &Path) -> Start {
    Start {
        compare: compare.is_some_and(|v| !v.is_empty() && v != "0"),
        preset: preset.filter(|p| !p.is_empty()).map(|p| {
            let p = PathBuf::from(p);
            if p.is_absolute() { p } else { library.join(p) }.to_string_lossy().into_owned()
        }),
    }
}

#[tauri::command]
pub fn compare_start(app: State<App>) -> Start {
    start_from(std::env::var("VISUALS_COMPARE").ok(), std::env::var("VISUALS_PRESET").ok(), &app.library)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("visuals-compare-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn writes_what_the_recorded_bench_writes() {
        let dir = temp("write");
        let file = dir.join("approvals.json");
        let mut all = read(&file).unwrap();
        assert!(all.is_empty());
        judge(&mut all, "b/two.milk", Some(Verdict::Reject), " too dark ", "2026-10-06T00:00:00.000Z".into());
        judge(&mut all, "a/one.milk", Some(Verdict::Approve), "", "2026-10-06T00:00:01.000Z".into());
        write(&file, &all).unwrap();
        let text = std::fs::read_to_string(&file).unwrap();
        // JSON.stringify(sorted, null, 1) + "\n", fields in compareReport.ts's order.
        assert_eq!(
            text,
            "{\n \"a/one.milk\": {\n  \"verdict\": \"approve\",\n  \"note\": \"\",\n  \"score\": null,\n  \"at\": \"2026-10-06T00:00:01.000Z\"\n },\n \
             \"b/two.milk\": {\n  \"verdict\": \"reject\",\n  \"note\": \"too dark\",\n  \"score\": null,\n  \"at\": \"2026-10-06T00:00:00.000Z\"\n }\n}\n"
        );
        assert_eq!(read(&file).unwrap(), all);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn keeps_the_score_and_fields_it_does_not_know() {
        let mut all: Approvals = serde_json::from_str(
            r#"{"x.milk": {"verdict": "reject", "note": "", "score": 61.5, "at": "then", "by": "ryan"}}"#,
        )
        .unwrap();
        let kept = judge(&mut all, "x.milk", Some(Verdict::Approve), "fine live", "now".into()).unwrap();
        assert_eq!(kept.score, Some(61.5));
        assert_eq!(kept.other.get("by"), Some(&serde_json::json!("ryan")));
        assert_eq!(kept.verdict, Some(Verdict::Approve));
        // No verdict and no note: gone, as the recorded bench's page does it.
        assert_eq!(judge(&mut all, "x.milk", None, "  ", "now".into()), None);
        assert!(all.is_empty());
        // A note alone stays.
        assert!(judge(&mut all, "y.milk", None, "check the waves", "now".into()).is_some());
    }

    #[test]
    fn will_not_write_over_a_file_it_cannot_read() {
        let dir = temp("broken");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("approvals.json");
        std::fs::write(&file, "{ not json").unwrap();
        assert!(read(&file).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn ids_are_paths_in_the_pack() {
        let library = Path::new("/p/presets");
        assert_eq!(id_of(library, Path::new("/p/presets/cream/Geometric/Cube.milk")), "cream/Geometric/Cube.milk");
        assert_eq!(id_of(library, Path::new("/elsewhere/x.milk")), "/elsewhere/x.milk");
    }

    #[test]
    fn iso_matches_javascript() {
        assert_eq!(iso(0), "1970-01-01T00:00:00.000Z");
        // new Date(1791331200123).toISOString()
        assert_eq!(iso(1_791_331_200_123), "2026-10-07T00:00:00.123Z");
        assert_eq!(iso(951_782_400_000), "2000-02-29T00:00:00.000Z");
    }

    #[test]
    fn levels_are_the_engines_bytes() {
        let left = vec![0.0f32; 2000];
        let mut right = vec![0.0f32; 2000];
        right[1999] = 1.0;
        let out = levels(48_000.0, &left, &right);
        assert_eq!(out.len(), 4 + 3 * 1024);
        assert_eq!(f32::from_le_bytes(out[..4].try_into().unwrap()), 48_000.0);
        // The newest sample is last in each window.
        assert_eq!(out[4 + 1023], (128.0f32 + 0.5 * 127.0).round() as u8);
        assert_eq!(out[4 + 1024 + 1023], 128);
        assert_eq!(out[4 + 2048 + 1023], 255);
        // A short ring is padded with silence at the start.
        let short = levels(0.0, &[1.0], &[-1.0]);
        assert_eq!((short[4 + 1024], short[4 + 1024 + 1023], short[4 + 2048 + 1023]), (128, 255, 1));
    }

    #[test]
    fn cache_names_stay_in_the_cache() {
        let library = Path::new("/p");
        assert!(cache_file(library, "milkdrop-preset-converter@0.1.2-repaired-4", "ab12").is_ok());
        assert!(cache_file(library, "../x", "ab").is_err());
        assert!(cache_file(library, "c", "a/b").is_err());
        assert!(cache_file(library, "..", "ab").is_err());
    }

    #[test]
    fn starts_from_the_environment() {
        let library = Path::new("/p");
        assert_eq!(start_from(None, None, library), Start { compare: false, preset: None });
        assert_eq!(start_from(Some("0".into()), None, library).compare, false);
        assert_eq!(start_from(Some("1".into()), Some("a/b.milk".into()), library).preset.as_deref(), Some("/p/a/b.milk"));
        assert_eq!(start_from(Some("1".into()), Some("/x.milk".into()), library).preset.as_deref(), Some("/x.milk"));
    }
}
