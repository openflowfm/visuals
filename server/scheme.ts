import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Archetype, Rule, Scheme } from '../protocol.ts';

/**
 * The scheme: what a song looks like, what a section feels like, what a track
 * does. Read from `visuals/scheme.json`, hot-reloaded, and entirely optional.
 *
 * **Everything here has a default that works**, which is the rule the file is
 * designed around. A rig that draws nothing until it has been configured is a
 * rig nobody configures, so the built-in scheme below is a complete show and the
 * file only ever overrides parts of it. Delete `scheme.json` and the picture
 * changes; it does not stop.
 *
 * It is a file rather than device state on purpose, for now. Archetypes belong
 * beside roles eventually — roles are already set-owned, they travel in the
 * `.als`, and a show that looked different on the gig laptop would be a bug.
 * But that costs a protocol change through `lom.ts`, `bridge.ts` and `ui/`, and
 * committing to a shape before it has met a real set is how you get a protocol
 * you regret. So: a file, shaped so it can move without changing.
 */

const BUILT_IN: Scheme = {
  colorways: {
    aurora: ['#3cc8ff', '#6ee7a0', '#9b5aff', '#3cff9b', '#e8f4ff'],
    ember: ['#ff5a3c', '#ffd23c', '#ff2d6f', '#ff9b3c', '#fff0c8'],
    dusk: ['#9b5aff', '#ff2d6f', '#3c6eff', '#ffd23c', '#f0e8ff'],
    mono: ['#ffffff', '#b7b7be', '#5e5e66', '#ececed', '#8b8b93'],
  },
  songs: {},
  archetypes: {
    INTRO: { energy: 0.2, effects: ['smear'] },
    VERSE: { energy: 0.35, effects: [] },
    // A build is the ramp into something, so it sits between a verse and a
    // chorus and reaches for the effect that moves the whole frame.
    BUILD: { energy: 0.65, effects: ['ripple'] },
    CHORUS: { energy: 0.9, effects: ['kaleido', 'ripple'] },
    // A bridge is a contrast rather than a peak: different, not louder.
    BRIDGE: { energy: 0.45, effects: ['mirror'] },
    JAM1: { energy: 0.75, effects: ['shift', 'smear'] },
    JAM2: { energy: 0.8, effects: ['mirror', 'kaleido'] },
    ENDING: { energy: 0.3, effects: ['smear'] },
    PRACTICE: { energy: 0.15, effects: [] },
  },
  tracks: [
    // Word boundaries are load-bearing, not tidiness. Without them `beat`
    // matches inside "Beating Pad" and a pad track draws as a drum — found
    // against a real set, where it was the only wrong layer on screen and the
    // hardest kind of wrong to trace back to a regular expression.
    { match: '\\b(kick|drums?|beats?|perc|snare)\\b', source: 'strobe', energyBias: 0.1, floor: 0 },
    { match: '\\b(bass|sub|808|303)\\b', source: 'bars', floor: 0.05 },
    // Before the keys rule: an arp is a sequence rather than a chord, and four
    // of them scattered across unrelated sources read as four unrelated things
    // when they are a family.
    { match: '\\barps?\\b', source: 'bars', energyBias: 0.05 },
    { match: '\\b(lead|solo|gtr|guitar|vox|vocal)\\b', source: 'rings', energyBias: 0.1 },
    { match: '\\b(pad|strings?|atmos|amb|texture)\\b', source: 'noise', energyBias: -0.15 },
    { match: '\\b(keys?|synth|chords?|piano|organ|pluck)\\b', source: 'grid' },
  ],
  clips: [],
  defaults: {
    colorway: 'aurora',
    energy: 0.4,
    blend: ['over', 'add', 'screen', 'add', 'multiply', 'add'],
    sources: ['bars', 'rings', 'grid', 'noise', 'strobe', 'solid'],
    maxEffects: 2,
  },
};

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.env.BSV_VISUALS_SCHEME ?? path.resolve(here, '../scheme.json');

export interface SchemeSource {
  current(): Scheme;
  /**
   * Replace it wholesale and write it back to disk.
   *
   * The file stays the record — the editor is a way of writing it, not a second
   * place the truth lives. Which also means a scheme edited in the browser is
   * one you can read, diff and commit afterwards.
   */
  replace(next: Scheme): void;
  /** The last parse failure, or null. Shown in the panel rather than logged away. */
  error(): string | null;
  stop(): void;
}

/**
 * Loads the scheme and follows the file.
 *
 * Watched rather than read once because the whole point of a file is that you
 * edit it with the picture on screen next to you. A parse failure **keeps the
 * scheme that was already working** and reports the message — losing the show
 * because of a trailing comma is the wrong answer at any time and an unthinkable
 * one during a set.
 */
export function openScheme(): SchemeSource {
  let scheme = BUILT_IN;
  let error: string | null = null;
  let watcher: fs.FSWatcher | null = null;
  let debounce: NodeJS.Timeout | null = null;
  /**
   * The last thing we wrote ourselves.
   *
   * Saving from the editor changes the file, which wakes the watcher, which
   * would re-read and re-publish what the editor already has — harmless but for
   * one thing: the re-read lands a render or two later and would yank a control
   * out from under a drag. Recognising our own write is what stops that.
   */
  let written: string | null = null;

  const load = () => {
    if (!fs.existsSync(FILE)) {
      scheme = BUILT_IN;
      error = null;
      return;
    }
    let text: string;
    try {
      text = fs.readFileSync(FILE, 'utf8');
    } catch {
      return;
    }
    if (written !== null && text.trim() === written.trim()) return;
    written = null;
    try {
      const parsed = JSON.parse(text) as Partial<Scheme>;
      scheme = merge(parsed);
      error = null;
      console.log(`visuals: scheme loaded from ${path.relative(process.cwd(), FILE)}`);
    } catch (err) {
      error = (err as Error).message;
      console.warn(`visuals: scheme not reloaded — ${error}`);
    }
  };

  load();

  try {
    // The directory, not the file: editors write by renaming a temp file over
    // the target, which breaks a watch on the inode and would silently stop
    // reloading after the first save.
    watcher = fs.watch(path.dirname(FILE), (_event, name) => {
      if (name && name !== path.basename(FILE)) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(load, 120);
    });
  } catch {
    // A platform without directory watching still runs; it just needs a restart.
  }

  return {
    current: () => scheme,
    error: () => error,
    replace(next) {
      scheme = merge(next);
      error = null;

      // Written over whatever the file already held rather than in place of it,
      // and indented rather than minified. The file is meant to be read, edited
      // by hand and committed — the editor is a way of writing the record, not a
      // second place the truth lives. Without this, the first turn of a knob
      // flattens it to one line and silently drops the `_` block explaining what
      // every key means.
      let held: Record<string, unknown> = {};
      try {
        held = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Record<string, unknown>;
      } catch {
        // No file yet, or an unparseable one we are about to replace anyway.
      }
      // Ours, so the watcher ignores the change it is about to see.
      written = JSON.stringify({ ...held, ...next }, null, 2);
      try {
        fs.writeFileSync(FILE, `${written}\n`);
      } catch (err) {
        error = `could not write ${path.basename(FILE)}: ${(err as Error).message}`;
      }
    },
    stop() {
      if (debounce) clearTimeout(debounce);
      watcher?.close();
    },
  };
}

/**
 * A file overrides the built-in scheme one section at a time.
 *
 * Shallow per section, deliberately. Naming one archetype should not delete the
 * other six, and naming one colourway should not leave every other song
 * unstyled — but a rule *list* replaces wholesale, because a list you can only
 * add to is a list you cannot correct.
 */
function merge(file: Partial<Scheme>): Scheme {
  return {
    colorways: { ...BUILT_IN.colorways, ...(file.colorways ?? {}) },
    songs: { ...BUILT_IN.songs, ...(file.songs ?? {}) },
    archetypes: { ...BUILT_IN.archetypes, ...(file.archetypes ?? {}) },
    tracks: file.tracks ?? BUILT_IN.tracks,
    clips: file.clips ?? BUILT_IN.clips,
    defaults: { ...BUILT_IN.defaults, ...(file.defaults ?? {}) },
  };
}

export interface CompiledRule {
  test: RegExp;
  rule: Rule;
}

/** Compiled once per resolve rather than per layer; a set has few rules and many cells. */
export function compile(rules: Rule[]): CompiledRule[] {
  const built: CompiledRule[] = [];
  for (const rule of rules) {
    try {
      built.push({ test: new RegExp(rule.match, 'i'), rule });
    } catch {
      // A bad pattern skips its own rule rather than taking the scheme down.
    }
  }
  return built;
}

/**
 * The first rule whose pattern is in the name, or null.
 *
 * First match rather than best match, so **order in the file is meaning**: an
 * arp rule above a keys rule is how "Pluck Arp" reads as a sequence rather than
 * a chord. Extracted from the resolver so it can be tested, which it earns —
 * this is where a missing word boundary turned "Beating Pad" into a drum, and a
 * mis-routed layer looks like a rendering bug rather than a regex one.
 */
export function firstMatch(rules: CompiledRule[], name: string): Rule | null {
  for (const { test, rule } of rules) if (test.test(name)) return rule;
  return null;
}

export { BUILT_IN };
