//! Authors and title from a preset's file name.
//!
//! The pack names presets `Author [+ Author] - Title [--- Editor edit…]`. Authors are case-folded
//! and mapped through a hand-checked alias table (`engine/authors.tsv`) so one person's spellings
//! count as one; names whose author part can't be read get [`UNKNOWN`].

use std::collections::HashMap;
use std::sync::LazyLock;

/// Who made a preset and what they called it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Name {
    /// Canonical, case-folded author names, in the order they're credited; `["unknown"]` when none could be read.
    pub authors: Vec<String>,
    /// The title, as written.
    pub title: String,
}

/// The author of a preset whose name has none that can be read.
pub const UNKNOWN: &str = "unknown";

/// `alias<TAB>canonical` lines; a canonical of `unknown` marks a title fragment, and `a + b` a joint credit.
const TABLE: &str = include_str!("../../authors.tsv");

/// Longest author name, in words, before an author part reads as a title fragment instead.
const MAX_WORDS: usize = 3;

static ALIASES: LazyLock<HashMap<String, Vec<String>>> = LazyLock::new(|| aliases(TABLE));

/// Parses the alias table: alias -> its canonical names.
fn aliases(table: &str) -> HashMap<String, Vec<String>> {
    table
        .lines()
        .filter(|line| !line.trim().is_empty() && !line.trim_start().starts_with('#'))
        .filter_map(|line| line.split_once('\t'))
        .map(|(alias, canonical)| (alias.trim().to_string(), canonical.split(" + ").map(|name| name.trim().to_string()).collect()))
        .collect()
}

/// Reads `Author [+ Author] - Title [--- edit]` from a file stem.
pub fn parse_name(stem: &str) -> Name {
    let (body, editor) = strip_edit(stem.trim());
    let mut name = match body.split_once(" === ") {
        // `! Transition` presets: `<what the transition does> === <Author> - <Title>`.
        Some((what, original)) => {
            let inner = parse_body(original.trim());
            Name { authors: inner.authors, title: format!("{} === {}", what.trim(), inner.title) }
        }
        None => parse_body(body),
    };
    if let Some(editor) = editor
        && !name.authors.contains(&editor)
    {
        name.authors.push(editor);
    }
    name
}

/// `Author - Title`, or the whole thing as the title of an unknown author.
fn parse_body(body: &str) -> Name {
    let unknown = || Name { authors: vec![UNKNOWN.to_string()], title: body.to_string() };
    // A few names use `_-_` for spaces: `DemonLD_-_Future_domination`.
    let Some(at) = [" - ", "_-_"].iter().filter_map(|dash| body.find(dash)).min() else { return unknown() };
    let (credit, title) = (&body[..at], &body[at + 3..]);
    let title = title.trim();
    match parse_authors(credit) {
        Some(authors) if !title.is_empty() => Name { authors, title: title.to_string() },
        _ => unknown(),
    }
}

/// Splits a trailing `--- <Editor> edit…` off a stem, returning the rest and the editor's canonical name.
fn strip_edit(stem: &str) -> (&str, Option<String>) {
    let Some((body, suffix)) = stem.rsplit_once(" --- ") else { return (stem, None) };
    let mut words = suffix.split_whitespace();
    match (words.next(), words.next()) {
        (Some(editor), Some(edit)) if edit.to_lowercase().starts_with("edit") => {
            let editor = canonical(&editor.to_lowercase()).and_then(|names| names.into_iter().next());
            (body.trim_end(), editor)
        }
        _ => (stem, None),
    }
}

/// The canonical authors credited by an author part, or `None` when it isn't plausibly a credit.
fn parse_authors(credit: &str) -> Option<Vec<String>> {
    let credit = credit.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    if let Some(names) = ALIASES.get(&credit) {
        return known(names.clone());
    }
    // Remixers are credited after the originals, as an editor is.
    let mut remixers = Vec::new();
    // AdamFX's mash-ups credit the originals after a ` 2 ` or ` ft `: `New Adam Master Mashup FX 2 Geiss`.
    let mut credit = credit.as_str();
    for joint in [" 2 ", " ft "] {
        if let Some((house, rest)) = credit.split_once(joint)
            && ["adam", "fx", "milk", "remix", "mash"].iter().any(|brand| house.contains(brand))
        {
            remixers.push("adamfx".to_string());
            credit = rest;
            break;
        }
    }
    let mut authors = Vec::new();
    for piece in split_credit(credit) {
        // `BDRV et al` remixes: `Bdrv Aderrasi`, `BDRV et AL shifter`, `bdrv + al EoS`.
        let piece = match piece.strip_prefix("bdrv ") {
            Some(original) => {
                remixers.push("bdrv".to_string());
                original
            }
            None => piece.as_str(),
        };
        let piece = ["et al ", "etal ", "al "].iter().fold(piece, |piece, et_al| piece.strip_prefix(et_al).unwrap_or(piece));
        let piece = piece.strip_suffix(" et al").unwrap_or(piece);
        if NOT_NAMES.contains(&piece) {
            continue;
        }
        if !plausible(piece) {
            return None;
        }
        for name in canonical(piece)? {
            if !authors.contains(&name) {
                authors.push(name);
            }
        }
    }
    if authors.is_empty() && remixers.is_empty() {
        return None;
    }
    for remixer in remixers {
        if !authors.contains(&remixer) {
            authors.push(remixer);
        }
    }
    Some(authors)
}

/// Pieces of a credit that name nobody: `bdrv + al`, `stahlregen + flexi + goody + martin + others`.
const NOT_NAMES: [&str; 6] = ["al", "et al", "etal", "others", "many others", "other artists"];

/// The names in a credit: joined by `+`, `&`, `,`, ` and `, ` n `, ` vs ` or ` ft `, each without a `(count)`.
fn split_credit(credit: &str) -> Vec<String> {
    let mut credit = format!(" {credit} ");
    for joint in [" and ", " n ", " vs. ", " vs ", " ft "] {
        while credit.contains(joint) {
            credit = credit.replace(joint, " , ");
        }
    }
    credit.split(['+', '&', ',']).map(strip_count).filter(|piece| !piece.is_empty()).collect()
}

/// `goody(2)` -> `goody`: the forum collaborations count each author's presets.
fn strip_count(piece: &str) -> String {
    let piece = piece.trim().trim_matches('_').trim();
    if let Some(open) = piece.rfind('(')
        && piece.ends_with(')')
        && piece[open + 1..piece.len() - 1].chars().all(|c| c.is_ascii_digit())
    {
        return piece[..open].trim().to_string();
    }
    piece.to_string()
}

/// Whether a piece of a credit reads as a name rather than a fragment of a title.
fn plausible(piece: &str) -> bool {
    piece.chars().any(char::is_alphabetic) && piece.split_whitespace().count() <= MAX_WORDS && !piece.contains(['(', ')', '[', ']']) && piece.matches('_').count() < 2
}

/// A case-folded name through the alias table; `None` when the table marks it as not an author.
fn canonical(name: &str) -> Option<Vec<String>> {
    known(ALIASES.get(name).cloned().unwrap_or_else(|| vec![name.to_string()]))
}

fn known(names: Vec<String>) -> Option<Vec<String>> {
    (!names.iter().any(|name| name == UNKNOWN)).then_some(names)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real stems from the cream-of-the-crop pack, with what they should read as.
    fn check(stem: &str, authors: &[&str], title: &str) {
        let want = Name { authors: authors.iter().map(|author| author.to_string()).collect(), title: title.to_string() };
        assert_eq!(parse_name(stem), want, "{stem}");
    }

    #[test]
    fn single_authors_are_case_folded() {
        check("Geiss - 3 layers (Minefield Mix)", &["geiss"], "3 layers (Minefield Mix)");
        check("EoS - glowstick base", &["eos"], "glowstick base");
        check("Rovastar - Blue Shining", &["rovastar"], "Blue Shining");
        check("amandio c - IFS 01", &["amandio c"], "IFS 01");
        check("Jc - Broken Crown", &["jc"], "Broken Crown");
    }

    #[test]
    fn joint_credits_split() {
        check("EoS+Phat - Flare_dig_mix", &["eos", "phat"], "Flare_dig_mix");
        check("Stahlregen & Geiss + TobiasWolfBoi - Jelly Space Desert Rose", &["stahlregen", "geiss", "tobiaswolfboi"], "Jelly Space Desert Rose");
        check("fishbrain and flexi - box of tricks 03 --- Isosceles edit", &["fishbrain", "flexi", "isosceles"], "box of tricks 03");
        check("Rozzor vs Esotic - Pixie Party Light (Party Down)", &["rozzor", "esotic"], "Pixie Party Light (Party Down)");
        check("goody(2), stahlregen (3), fed (1) - 2nd collaboration(ps2-0) (liquid metal)", &["goody", "stahlregen", "fed"], "2nd collaboration(ps2-0) (liquid metal)");
        check("flexci + rovastar + martin + others - 5D snowflake", &["flexi", "rovastar", "martin"], "5D snowflake");
        check("Bdrv Aderrasi - Chromatic Voyage bdrv etAL", &["aderrasi", "bdrv"], "Chromatic Voyage bdrv etAL");
    }

    #[test]
    fn titles_keep_their_own_dashes() {
        check("Hexcollie, Krash, bdrv, EoS n aderassi - Fractal rebirth - from hell", &["hexcollie", "krash", "bdrv", "eos", "aderrasi"], "Fractal rebirth - from hell");
        check("Flexi - $0$ - rotating per-pixel tutorial", &["flexi"], "$0$ - rotating per-pixel tutorial");
        check("DemonLD_-_Future_domination - mash0000 - sclera torture", &["demonld"], "Future_domination - mash0000 - sclera torture");
    }

    #[test]
    fn edits_credit_the_editor_after_the_originals() {
        check("Zylot - Azirphaeli's Mirror --- Isosceles edit", &["zylot", "isosceles"], "Azirphaeli's Mirror");
        check("suksma - sac of sac --- Isoseceles edit1", &["suksma", "isosceles"], "sac of sac");
        check("Flexi - emergencey 2 --- Isosceles edit10a rings", &["flexi", "isosceles"], "emergencey 2");
        check(
            "TonyMilkdrop - Tricolors [Flexi - away with it + $this shall not retain] --- Isosceled edit",
            &["tonymilkdrop", "isosceles"],
            "Tricolors [Flexi - away with it + $this shall not retain]",
        );
        check("whoraeckle' - curt ain Rod --- Isosceles edit", &["whoraeckle'", "isosceles"], "curt ain Rod");
    }

    #[test]
    fn transitions_take_the_original_credit() {
        check(
            "Slow transition to black - gas effect + zoom out === amandio c - magnetosphere --- Isosceles edit",
            &["amandio c", "isosceles"],
            "Slow transition to black - gas effect + zoom out === magnetosphere",
        );
        check(
            "Fast transition to black - levels effect === Goody's Lightning (ps 2-0) --- Isosceles edit",
            &["unknown", "isosceles"],
            "Fast transition to black - levels effect === Goody's Lightning (ps 2-0)",
        );
    }

    #[test]
    fn aliases_merge_spellings() {
        check("$$$ Royal - Mashup (1)", &["royal"], "Mashup (1)");
        check("Phat_Rovastar - 1337 boxes", &["phat", "rovastar"], "1337 boxes");
        check("sukma - flexi - fractrip (bccn Jelly V4) - phalanxed", &["suksma"], "flexi - fractrip (bccn Jelly V4) - phalanxed");
        check("Hexcollie, Rova n EOS - Flatliner", &["hexcollie", "rovastar", "eos"], "Flatliner");
        check("Esotic & Rozzer - Hippie Hypnotizer", &["esotic", "rozzor"], "Hippie Hypnotizer");
        check(
            "Demon Lord + Flexi - Future dominanta [da trolls lair mix]{not the northrop war-masheenery}",
            &["demonld", "flexi"],
            "Future dominanta [da trolls lair mix]{not the northrop war-masheenery}",
        );
    }

    #[test]
    fn adamfx_mashups_credit_the_originals_first() {
        check("New Adam Master Mashup FX 2 Geiss - Cosmic Dust 2 - Tiny Reaction Diffusion Mix 2", &["geiss", "adamfx"], "Cosmic Dust 2 - Tiny Reaction Diffusion Mix 2");
        check(
            "A MilkKing Recreation FT Martin  - Violet Flash ft AdamFX Rovastar n Krash - Twisted in Notranomi Nebula",
            &["martin", "adamfx"],
            "Violet Flash ft AdamFX Rovastar n Krash - Twisted in Notranomi Nebula",
        );
        check(
            "Liquid Glowsticks - ATwisted Pre Set Mix By AdamFX 2 martin - disco mix Ft Hexocollie 22",
            &["martin", "adamfx"],
            "ATwisted Pre Set Mix By AdamFX 2 martin - disco mix Ft Hexocollie 22",
        );
    }

    #[test]
    fn unreadable_credits_are_unknown() {
        check("Brownian Bass", &["unknown"], "Brownian Bass");
        check("xtramartin (970)", &["unknown"], "xtramartin (970)");
        check("Isosceles mashup01", &["unknown"], "Isosceles mashup01");
        check("skipper skipper kiss me hard - inspired by unmitigated torture", &["unknown"], "skipper skipper kiss me hard - inspired by unmitigated torture");
        check("fleekus flokus - ap3 roam2 as fuck would have it", &["unknown"], "fleekus flokus - ap3 roam2 as fuck would have it");
        check("segment (inner centipede - organ autonomy) meta tinstaapn", &["unknown"], "segment (inner centipede - organ autonomy) meta tinstaapn");
        check("Goody's Trichromatic Mind Games (Red is Good remix) --- Isosceles edit", &["unknown", "isosceles"], "Goody's Trichromatic Mind Games (Red is Good remix)");
    }

    #[test]
    fn alias_table_is_well_formed() {
        let table = aliases(TABLE);
        let mut lines = 0;
        for line in TABLE.lines().filter(|line| !line.trim().is_empty() && !line.starts_with('#')) {
            lines += 1;
            let fields: Vec<_> = line.split('\t').collect();
            assert_eq!(fields.len(), 2, "two tab-separated fields: {line:?}");
            let (alias, canonical) = (fields[0], fields[1]);
            assert!(!alias.is_empty() && !canonical.is_empty(), "empty field: {line:?}");
            assert_eq!(alias, alias.trim().to_lowercase(), "alias is trimmed and lowercase: {line:?}");
            for name in canonical.split(" + ") {
                assert!(!name.is_empty(), "empty canonical name: {line:?}");
                assert_eq!(name, name.trim().to_lowercase(), "canonical is trimmed and lowercase: {line:?}");
                assert_ne!(name, alias, "alias maps to itself: {line:?}");
                assert!(!table.contains_key(name), "chain: {line:?} maps to another alias");
            }
        }
        assert_eq!(table.len(), lines, "an alias is listed twice");
    }
}
