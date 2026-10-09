//! Smart playlists: a [`LibraryQuery`], the page's library filter (`LibraryQuery`
//! in `app/src/api.ts`), worked out from Rust over the library's rows
//! ([`crate::catalog::rows`]) and what the user keeps about them
//! ([`crate::userlib`]).
//!
//! It mirrors the page's filter: the user's overrides win over the index's
//! values; a row matches when, for every group the query gives values for, it
//! has at least one of them (AND across groups, OR within), and every word of
//! the text is in its key, style, sub-style, authors, title or tags.

use crate::catalog::Row;
use crate::userlib::{LibraryData, Mine};
use engine::index::Level;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;

/// The library's filter, as the page sends it.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct LibraryQuery {
    /// Values by group: `style`, `author`, `colour`, `speed`, `intensity`, `star`, `tags`.
    pub groups: BTreeMap<String, Vec<String>>,
    /// Words, each of which must be found.
    pub text: String,
    /// Only the presets among the last this many played, newest first (the "recently played" smart playlist).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recent: Option<usize>,
}

/// The colour name of a hue in degrees, as the page names it.
pub fn colour_of(hue: u16) -> &'static str {
    match hue % 360 {
        h if !(15..345).contains(&h) => "red",
        h if h < 45 => "orange",
        h if h < 75 => "yellow",
        h if h < 165 => "green",
        h if h < 195 => "cyan",
        h if h < 255 => "blue",
        h if h < 285 => "purple",
        _ => "pink",
    }
}

fn level(l: Level) -> String {
    match l {
        Level::Low => "low",
        Level::Mid => "mid",
        Level::High => "high",
    }
    .to_string()
}

/// A row's values for `group`, overrides applied; `None` for a group there's no such thing as.
fn values(group: &str, row: &Row, mine: Option<&Mine>) -> Option<Vec<String>> {
    let o = mine.map(|m| &m.overrides);
    let look = row.look.as_ref();
    Some(match group {
        "style" => {
            let style = o.and_then(|o| o.style.clone()).unwrap_or_else(|| row.style.clone());
            match o.and_then(|o| o.sub_style.clone()).or_else(|| row.sub_style.clone()) {
                Some(sub) => vec![style.clone(), format!("{style}/{sub}")],
                None => vec![style],
            }
        }
        "author" => o.and_then(|o| o.authors.clone()).unwrap_or_else(|| row.authors.clone()),
        "colour" => {
            let hues = o.and_then(|o| o.hues.clone()).or_else(|| look.map(|l| l.hues.clone()));
            match hues {
                None => Vec::new(),
                Some(h) if h.is_empty() => vec!["grey".to_string()],
                Some(h) => {
                    let mut names: Vec<String> = Vec::new();
                    for name in h.into_iter().map(colour_of) {
                        if !names.iter().any(|n| n == name) {
                            names.push(name.to_string());
                        }
                    }
                    names
                }
            }
        }
        "speed" => o.and_then(|o| o.speed).or_else(|| look.map(|l| l.speed_level)).map(level).into_iter().collect(),
        "intensity" => o.and_then(|o| o.intensity).or_else(|| look.map(|l| l.intensity_level)).map(level).into_iter().collect(),
        "star" => mine.filter(|m| m.star).map(|_| "starred".to_string()).into_iter().collect(),
        "tags" => mine.map(|m| m.tags.clone()).unwrap_or_default(),
        _ => return None,
    })
}

/// The text a row's words are looked for in, lower-cased.
fn haystack(row: &Row, mine: Option<&Mine>) -> String {
    let o = mine.map(|m| &m.overrides);
    let style = o.and_then(|o| o.style.clone()).unwrap_or_else(|| row.style.clone());
    let sub = o.and_then(|o| o.sub_style.clone()).or_else(|| row.sub_style.clone()).unwrap_or_default();
    let authors = o.and_then(|o| o.authors.clone()).unwrap_or_else(|| row.authors.clone()).join(" ");
    let title = o.and_then(|o| o.title.clone()).unwrap_or_else(|| row.title.clone());
    let tags = mine.map(|m| m.tags.join(" ")).unwrap_or_default();
    format!("{} {style} {sub} {authors} {title} {tags}", row.key).to_lowercase()
}

/// Whether `row` (with what the user keeps about it, `mine`) is one `query` picks.
/// A group the query names that there's no such thing as (not one of `style`,
/// `author`, `colour`, `speed`, `intensity`, `star`, `tags`) matches nothing when
/// it has values. `recent` and hidden presets are [`resolve`]'s business, not this.
pub fn matches(query: &LibraryQuery, row: &Row, mine: Option<&Mine>) -> bool {
    for (group, wanted) in &query.groups {
        if wanted.is_empty() {
            continue;
        }
        let Some(has) = values(group, row, mine) else { return false };
        if !wanted.iter().any(|w| has.contains(w)) {
            return false;
        }
    }
    let words: Vec<String> = query.text.split_whitespace().map(str::to_lowercase).collect();
    if words.is_empty() {
        return true;
    }
    let text = haystack(row, mine);
    words.iter().all(|w| text.contains(w.as_str()))
}

/// The presets `query` picks from `rows` (catalog order, by key), never a hidden one; with `recent`, only those among
/// the first `recent` of `played` (preset paths, newest first), in that order.
pub fn resolve(query: &LibraryQuery, rows: &[Row], data: &LibraryData, played: &[String]) -> Vec<PathBuf> {
    let picked = rows.iter().filter(|r| {
        let mine = data.presets.get(&r.key);
        !mine.is_some_and(|m| m.hidden) && matches(query, r, mine)
    });
    match query.recent {
        None => picked.map(|r| PathBuf::from(&r.path)).collect(),
        Some(n) => {
            let picked: HashSet<&str> = picked.map(|r| r.path.as_str()).collect();
            let mut out: Vec<PathBuf> = Vec::new();
            for p in played.iter().take(n) {
                let path = PathBuf::from(p);
                if picked.contains(p.as_str()) && !out.contains(&path) {
                    out.push(path);
                }
            }
            out
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::userlib::Overrides;
    use engine::index::Look;

    fn row(key: &str, style: &str, sub: Option<&str>, authors: &[&str], look: Option<Look>) -> Row {
        Row {
            key: key.into(),
            path: format!("/presets/{key}"),
            hash: String::new(),
            style: style.into(),
            sub_style: sub.map(Into::into),
            authors: authors.iter().map(|a| a.to_string()).collect(),
            title: key.rsplit('/').next().unwrap().trim_end_matches(".milk").into(),
            thumbnail: None,
            look,
            starter: false,
        }
    }

    fn look(hues: Vec<u16>, speed: Level, intensity: Level) -> Look {
        let mut l = Look::new(hues, 0.5, None, 10.0);
        l.speed_level = speed;
        l.intensity_level = intensity;
        l
    }

    fn q(groups: &[(&str, &[&str])], text: &str) -> LibraryQuery {
        LibraryQuery { groups: groups.iter().map(|(g, v)| (g.to_string(), v.iter().map(|s| s.to_string()).collect())).collect(), text: text.into(), recent: None }
    }

    fn rows() -> Vec<Row> {
        vec![
            row("p/Dancer/Whirl/a.milk", "Dancer", Some("Whirl"), &["orb"], Some(look(vec![0, 20, 350], Level::High, Level::Low))),
            row("p/Dancer/b.milk", "Dancer", None, &["geiss"], Some(look(vec![], Level::Low, Level::Mid))),
            row("p/Fractal/c.milk", "Fractal", None, &["orb", "geiss"], None),
        ]
    }

    fn keys(query: &LibraryQuery, rows: &[Row], data: &LibraryData) -> Vec<String> {
        rows.iter().filter(|r| matches(query, r, data.presets.get(&r.key))).map(|r| r.key.clone()).collect()
    }

    #[test]
    fn groups_are_anded_and_their_values_ored() {
        let (rows, data) = (rows(), LibraryData::default());
        assert_eq!(keys(&q(&[("style", &["Dancer", "Fractal"])], ""), &rows, &data).len(), 3);
        assert_eq!(keys(&q(&[("style", &["Dancer"]), ("author", &["geiss"])], ""), &rows, &data), ["p/Dancer/b.milk"]);
        assert_eq!(keys(&q(&[("style", &["Dancer/Whirl"])], ""), &rows, &data), ["p/Dancer/Whirl/a.milk"]);
        assert_eq!(keys(&q(&[("speed", &["high"]), ("intensity", &["low", "mid"])], ""), &rows, &data), ["p/Dancer/Whirl/a.milk"]);
        assert_eq!(keys(&q(&[("style", &[])], ""), &rows, &data).len(), 3);
    }

    #[test]
    fn colours_are_named_and_a_drawn_preset_with_no_hues_is_grey() {
        let (rows, data) = (rows(), LibraryData::default());
        assert_eq!(values("colour", &rows[0], None).unwrap(), ["red", "orange"]);
        assert_eq!(keys(&q(&[("colour", &["grey"])], ""), &rows, &data), ["p/Dancer/b.milk"]);
        assert!(values("colour", &rows[2], None).unwrap().is_empty());
        let names: Vec<_> = [10, 30, 60, 100, 180, 200, 270, 300, 350, 365].into_iter().map(colour_of).collect();
        assert_eq!(names, ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink", "red", "red"]);
    }

    #[test]
    fn the_users_overrides_star_and_tags_count() {
        let rows = rows();
        let mut data = LibraryData::default();
        let overrides = Overrides { style: Some("Hypnotic".into()), hues: Some(vec![220]), speed: Some(Level::Low), authors: Some(vec!["me".into()]), ..Default::default() };
        data.presets.insert("p/Fractal/c.milk".into(), Mine { star: true, tags: vec!["warm up".into()], overrides, ..Default::default() });
        let c = ["p/Fractal/c.milk"];
        assert_eq!(keys(&q(&[("style", &["Hypnotic"])], ""), &rows, &data), c);
        assert!(keys(&q(&[("style", &["Fractal"])], ""), &rows, &data).is_empty());
        assert_eq!(keys(&q(&[("colour", &["blue"]), ("speed", &["low"])], ""), &rows, &data), c);
        assert_eq!(keys(&q(&[("author", &["me"])], ""), &rows, &data), c);
        assert_eq!(keys(&q(&[("star", &["starred"])], ""), &rows, &data), c);
        assert_eq!(keys(&q(&[("tags", &["warm up"])], ""), &rows, &data), c);
        assert_eq!(keys(&q(&[], "WARM hypno"), &rows, &data), c);
    }

    #[test]
    fn every_word_of_the_text_must_be_found() {
        let (rows, data) = (rows(), LibraryData::default());
        assert_eq!(keys(&q(&[], "  whirl ORB "), &rows, &data), ["p/Dancer/Whirl/a.milk"]);
        assert_eq!(keys(&q(&[], "geiss"), &rows, &data), ["p/Dancer/b.milk", "p/Fractal/c.milk"]);
        assert!(keys(&q(&[], "geiss whirl"), &rows, &data).is_empty());
    }

    #[test]
    fn an_unknown_group_with_values_matches_nothing() {
        let (rows, data) = (rows(), LibraryData::default());
        assert!(keys(&q(&[("mood", &["happy"])], ""), &rows, &data).is_empty());
        assert_eq!(keys(&q(&[("mood", &[])], ""), &rows, &data).len(), 3);
    }

    #[test]
    fn resolve_skips_hidden_presets_and_keeps_catalog_order() {
        let rows = rows();
        let mut data = LibraryData::default();
        data.presets.insert("p/Dancer/b.milk".into(), Mine { hidden: true, ..Default::default() });
        let all = resolve(&LibraryQuery::default(), &rows, &data, &[]);
        assert_eq!(all, [PathBuf::from("/presets/p/Dancer/Whirl/a.milk"), PathBuf::from("/presets/p/Fractal/c.milk")]);
    }

    #[test]
    fn recent_keeps_the_newest_played_in_order_up_to_its_limit() {
        let rows = rows();
        let mut data = LibraryData::default();
        data.presets.insert("p/Dancer/b.milk".into(), Mine { hidden: true, ..Default::default() });
        let played: Vec<String> =
            ["/presets/p/Fractal/c.milk", "/elsewhere/x.milk", "/presets/p/Dancer/b.milk", "/presets/p/Fractal/c.milk", "/presets/p/Dancer/Whirl/a.milk"].map(String::from).to_vec();
        let recent = |n, groups: &[(&str, &[&str])]| resolve(&LibraryQuery { recent: Some(n), ..q(groups, "") }, &rows, &data, &played);
        assert_eq!(recent(10, &[]), [PathBuf::from("/presets/p/Fractal/c.milk"), PathBuf::from("/presets/p/Dancer/Whirl/a.milk")]);
        assert_eq!(recent(4, &[]), [PathBuf::from("/presets/p/Fractal/c.milk")]);
        assert_eq!(recent(10, &[("style", &["Dancer"])]), [PathBuf::from("/presets/p/Dancer/Whirl/a.milk")]);
        assert!(recent(0, &[]).is_empty());
    }

    #[test]
    fn the_query_reads_as_the_page_sends_it() {
        let parsed: LibraryQuery = serde_json::from_str(r#"{"groups":{"style":["Dancer"]},"text":"orb"}"#).unwrap();
        assert_eq!(parsed, q(&[("style", &["Dancer"])], "orb"));
        assert_eq!(serde_json::to_string(&LibraryQuery::default()).unwrap(), r#"{"groups":{},"text":""}"#);
    }
}
