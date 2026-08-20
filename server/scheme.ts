import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Archetype, LayerSpec, LookDef, Scheme, SongSpec } from '../protocol.ts';


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
    INTRO: { energy: 0.2, looks: ['smear'] },
    VERSE: { energy: 0.35, looks: [] },
    // A build is the ramp into something, so it sits between a verse and a
    // chorus and reaches for the effect that moves the whole frame.
    BUILD: { energy: 0.65, looks: ['ripple'] },
    CHORUS: { energy: 0.9, looks: ['kaleido', 'ripple'] },
    // A bridge is a contrast rather than a peak: different, not louder.
    BRIDGE: { energy: 0.45, looks: ['mirror'] },
    JAM1: { energy: 0.75, looks: ['shift', 'smear'] },
    JAM2: { energy: 0.8, looks: ['mirror', 'kaleido'] },
    ENDING: { energy: 0.3, looks: ['smear'] },
    PRACTICE: { energy: 0.15, looks: [] },
  },
  layers: {},
  clips: {},
  // Ids are what an archetype or a layer names, so the built-ins claim their own
  // spelling and a circuit gets a fresh one. Parameters are deliberately absent:
  // each built-in declares its own defaults in `src/render/shaders.ts`, and a
  // value only lands here once someone has actually moved it.
  //
  // Generators and transformers in one map, because they are one noun now. The
  // only thing that still tells them apart is `isGenerator`, and it asks the
  // look rather than reading which list it came out of.
  looks: {
    solid: { name: 'Solid', builtin: 'solid' },
    bars: { name: 'Bars', builtin: 'bars' },
    rings: { name: 'Rings', builtin: 'rings' },
    noise: { name: 'Noise', builtin: 'noise' },
    strobe: { name: 'Strobe', builtin: 'strobe' },
    grid: { name: 'Grid', builtin: 'grid' },
    tunnel: { name: 'Tunnel', builtin: 'tunnel' },
    plasma: { name: 'Plasma', builtin: 'plasma' },
    spiral: { name: 'Spiral', builtin: 'spiral' },
    scan: { name: 'Scan', builtin: 'scan' },
    sparks: { name: 'Sparks', builtin: 'sparks' },
    mirror: { name: 'Mirror', builtin: 'mirror' },
    kaleido: { name: 'Kaleido', builtin: 'kaleido' },
    shift: { name: 'Shift', builtin: 'shift' },
    pixelate: { name: 'Pixelate', builtin: 'pixelate' },
    ripple: { name: 'Ripple', builtin: 'ripple' },
    smear: { name: 'Smear', builtin: 'smear' },
    bloom: { name: 'Bloom', builtin: 'bloom' },
    slice: { name: 'Slice', builtin: 'slice' },
    edge: { name: 'Edge', builtin: 'edge' },
    posterize: { name: 'Posterize', builtin: 'posterize' },
    twist: { name: 'Twist', builtin: 'twist' },
    invert: { name: 'Invert', builtin: 'invert' },
  },
  defaults: {
    colorway: 'aurora',
    energy: 0.4,
    // Weighted toward `screen`, which saturates at white rather than climbing
    // past it. Half the cycle used to be `add`, which on a set of twenty-seven
    // tracks is a white rectangle by the fourth layer however good each of them
    // looks alone. `add` is still here, because nothing else has its bite.
    blend: ['over', 'screen', 'add', 'screen', 'multiply', 'screen'],
    looks: ['plasma', 'bars', 'rings', 'grid', 'spiral', 'noise', 'scan', 'strobe', 'sparks'],
    // One more than the old cap, because the base now counts toward it: two
    // transformers on top of a base is what `maxEffects: 2` used to mean.
    maxLooks: 3,
    pace: 0,
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
   * The file lags the edit by a moment, deliberately.
   *
   * A knob turning and a node being dragged both emit on every pointer move, so
   * an editor mid-gesture sends sixty schemes a second. What it holds is
   * published immediately — the show must follow the pointer — but writing the
   * file that often would put a synchronous write in the middle of a drag for
   * no benefit, since nobody reads the file until the gesture is over.
   */
  let pending: NodeJS.Timeout | null = null;
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
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => {
        pending = null;
        write(next);
      }, 200);
    },
    stop() {
      if (debounce) clearTimeout(debounce);
      if (pending) {
        clearTimeout(pending);
        write(scheme);
      }
      watcher?.close();
    },
  };

  function write(next: Scheme) {
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
  }
}

/**
 * A file overrides the built-in scheme one section at a time.
 *
 * Shallow per section, deliberately. Naming one archetype should not delete the
 * other six, and naming one colourway should not leave every other song
 * unstyled. `layers` and `clips` merge the same way, because they are keyed by a
 * name the set owns: an entry for one track has nothing to say about another.
 */
export function merge(raw: Partial<Scheme>): Scheme {
  const file = carried(raw);
  return {
    // Carried rather than rebuilt, so a rolled show can still say where it came
    // from after a reload. Without it the seed lived exactly as long as the tab.
    ...(file.seed ? { seed: file.seed } : {}),
    colorways: { ...BUILT_IN.colorways, ...(file.colorways ?? {}) },
    songs: songsOf(file.songs),
    archetypes: { ...BUILT_IN.archetypes, ...(file.archetypes ?? {}) },
    layers: { ...BUILT_IN.layers, ...(file.layers ?? {}) },
    clips: { ...BUILT_IN.clips, ...(file.clips ?? {}) },
    looks: { ...BUILT_IN.looks, ...(file.looks ?? {}) },
    defaults: { ...BUILT_IN.defaults, ...(file.defaults ?? {}) },
  };
}

/**
 * A scheme written before source and effect became one noun.
 *
 * The split was real on disk for months, so a file out there says `effects`,
 * `source`, `sources` and `maxEffects` — including the one rolled last night
 * and committed. Refusing it would mean losing a show to a rename, which is the
 * wrong answer at any time and an unthinkable one before a gig.
 *
 * Carried rather than migrated in place: the file is not rewritten until
 * someone saves, and then it is written in the new spelling. Reading an old
 * file and writing a new one is the whole migration.
 */
function carried(file: Partial<Scheme> & LegacyScheme): Partial<Scheme> {
  const out: Partial<Scheme> & LegacyScheme = { ...file };

  if (!out.looks && out.effects) out.looks = out.effects;
  delete out.effects;

  const fold = (spec: (LayerSpec & LegacyLayer) | undefined): LayerSpec | undefined => {
    if (!spec) return spec;
    const { source, effects, ...rest } = spec;
    if (!source && !effects) return rest;
    // The base first, which is exactly where a source always sat.
    return { ...rest, looks: [...(source ? [source] : []), ...(effects ?? [])] };
  };
  const foldAll = (record: Record<string, LayerSpec & LegacyLayer> | undefined) =>
    record &&
    (Object.fromEntries(
      Object.entries(record).map(([key, spec]) => [key, fold(spec)]),
    ) as Record<string, LayerSpec>);

  out.layers = foldAll(out.layers as Record<string, LayerSpec & LegacyLayer> | undefined);
  out.clips = foldAll(out.clips as Record<string, LayerSpec & LegacyLayer> | undefined);

  if (out.archetypes) {
    out.archetypes = Object.fromEntries(
      Object.entries(out.archetypes).map(([role, arch]) => {
        const { effects: was, ...rest } = arch as Archetype & { effects?: string[] };
        return [role, was && !rest.looks ? { ...rest, looks: was } : rest];
      }),
    );
  }

  if (out.defaults) {
    const { sources, maxEffects, ...rest } = out.defaults as Scheme['defaults'] & LegacyDefaults;
    out.defaults = {
      ...rest,
      ...(rest.looks || !sources ? {} : { looks: sources }),
      ...(rest.maxLooks || maxEffects === undefined ? {} : { maxLooks: maxEffects + 1 }),
    };
  }

  return out;
}

/** The shapes a file written before the collapse can still be in. */
interface LegacyScheme {
  effects?: Record<string, LookDef>;
}
interface LegacyLayer {
  source?: string;
  effects?: string[];
}
interface LegacyDefaults {
  sources?: string[];
  maxEffects?: number;
}

/**
 * A song used to be assigned a colourway and nothing else, so its whole entry
 * was the colourway's name. It owns a second thing now — how hard it plays its
 * own sections — and a bare string still means what it always did rather than
 * quietly unstyling every song in a file written last week.
 */
function songsOf(songs: Record<string, SongSpec | string> | undefined): Record<string, SongSpec> {
  const out: Record<string, SongSpec> = { ...BUILT_IN.songs };
  for (const [name, spec] of Object.entries(songs ?? {})) {
    out[name] = typeof spec === 'string' ? { colorway: spec } : spec;
  }
  return out;
}

export { BUILT_IN };
