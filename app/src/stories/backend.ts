/**
 * The app behind the page, faked for Storybook: every Tauri command the page
 * sends answered from the fixtures (`fixtures.ts`), with the events it would
 * send after a change, through `@tauri-apps/api/mocks`. `.storybook/preview.tsx`
 * installs a fresh one before each story, from the story's `parameters.tauri`
 * (a `Partial<World>`), so no story needs the Rust app. It keeps what a story
 * changes (a star, a playlist's settings, the next preset) until the next story.
 */
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import type * as api from '../api.ts';
import type * as fx from '../fx.ts';
import type * as link from '../link.ts';
import type * as output from '../output.ts';
import type * as pack from '../pack.ts';
import type * as pl from '../playlists.ts';
import * as F from './fixtures.ts';

/** The app's state, as the commands read it. */
export interface World {
  rows: api.LibraryRow[];
  entries: api.Entry[];
  data: api.LibraryData;
  lists: pl.Lists;
  /** What `deck_items` says is playing, in order; the playing playlist's own when left null. */
  deckItems: string[] | null;
  recent: string[];
  failed: string[];
  problems: api.SettingsProblem[];
  fx: fx.Fx;
  link: link.Frame;
  output: output.Status;
  displays: output.Display[];
  pack: pack.PackStatus;
  quality: api.Quality;
  motion: api.Motion;
  crashes: api.CrashReport[];
  crashesEnabled: boolean;
  update: api.Update | null;
  sources: api.AudioSources;
  heard: api.Heard;
  levels: [number, number];
  stats: api.Stats;
  firstRun: boolean;
  flashUnderstood: boolean;
  resume: api.Resume | null;
  /** `live_start`: the view to start in. */
  start: output.StartView | null;
  /** Commands that never answer: their callers stay loading. */
  hang: string[];
  /** Commands that fail, with what they say. */
  fail: Record<string, string>;
}

export const world = (over: Partial<World> = {}): World => ({
  rows: F.ROWS,
  entries: F.ENTRIES,
  data: F.DATA,
  lists: F.LISTS,
  deckItems: null,
  recent: F.RECENT,
  failed: [],
  problems: [],
  fx: F.FX,
  link: F.LINK,
  output: F.OUTPUT_OFF,
  displays: F.DISPLAYS,
  pack: F.PACK_STATUS,
  quality: F.QUALITY,
  motion: F.MOTION,
  crashes: [],
  crashesEnabled: true,
  update: null,
  sources: F.SOURCES,
  heard: F.HEARD,
  levels: [0.46, 0.4],
  stats: { fps: 60, cpu_ms: 3.1 },
  firstRun: false,
  flashUnderstood: true,
  resume: null,
  start: null,
  hang: [],
  fail: {},
  ...over,
});

type Args = Record<string, unknown>;
const never = new Promise<never>(() => {});

/** The deck after playing `path` at `index` of the playlist `list`, its next the one after. */
function play(lists: pl.Lists, list: pl.Playlist | null, index: number | null, path: string | null): pl.Deck {
  const items = list?.items ?? [];
  const next = list && items.length ? (index === null ? 0 : (index + 1) % items.length) : null;
  return {
    ...lists.deck,
    playlist: list?.id ?? null,
    index,
    current: path,
    settings: list?.settings ?? null,
    differs: list ? [] : lists.deck.differs,
    next: next !== null ? items[next].path : null,
    next_index: next,
    count: items.length,
    query: list ? null : lists.deck.query,
  };
}

/** The command handler over `w`, which it changes as the app would. */
export function handler(w: World) {
  const lists = (next: pl.Lists): pl.Lists => {
    w.lists = next;
    void emit('lists', next);
    return next;
  };
  const changeList = (id: string, f: (p: pl.Playlist) => pl.Playlist) => lists({ ...w.lists, playlists: w.lists.playlists.map((p) => (p.id === id ? f(p) : p)) });
  const live = (deck: pl.Deck) => {
    w.lists = { ...w.lists, deck };
    void emit('live', { deck, opened: null, path: deck.current, error: null } satisfies pl.Now);
  };
  const setFx = (next: fx.Fx) => {
    w.fx = next;
    void emit('fx', next);
  };
  const itemFor = (path: string): pl.Item => {
    const r = w.rows.find((x) => x.path === path);
    return r ? F.itemOf(r) : { path, name: path.split('/').pop()!.replace(/\.milk$/i, ''), group: '', missing: false, hash: null };
  };

  function act(action: Args) {
    const deck = w.lists.deck;
    const list = w.lists.playlists.find((p) => p.id === deck.playlist) ?? null;
    const items = list?.items ?? [];
    const at = (i: number) => live(play(w.lists, list, i, items[i]?.path ?? null));
    switch (action.kind) {
      case 'next':
        if (deck.hold) return;
        if (items.length) at(deck.index === null ? 0 : (deck.index + 1) % items.length);
        else if (deck.next) live({ ...deck, current: deck.next });
        return;
      case 'previous':
        if (deck.hold) return;
        if (items.length) at(deck.index === null || deck.index === 0 ? items.length - 1 : deck.index - 1);
        return;
      case 'random':
        if (deck.hold) return;
        if (items.length) at(Math.floor(Math.random() * items.length));
        else live({ ...deck, current: w.rows[Math.floor(Math.random() * w.rows.length)].path });
        return;
      case 'go':
        at(action.index as number);
        return;
      case 'load': {
        const p = w.lists.playlists[action.playlist as number] ?? null;
        const i = (action.index as number | null) ?? 0;
        live(play(w.lists, p, i, p?.items[i]?.path ?? null));
        return;
      }
      case 'unload':
        live(play(w.lists, null, null, deck.current));
        return;
      case 'auto':
        live({ ...deck, auto: (action.on as boolean | null) ?? !deck.auto });
        return;
      case 'seconds':
        live({ ...deck, seconds: action.seconds as number });
        return;
      case 'hold': {
        const on = (action.on as boolean | null) ?? !deck.hold;
        live({ ...deck, hold: on });
        setFx({ ...w.fx, hold: on });
        return;
      }
      case 'bars':
        live({ ...deck, bars: action.bars as number });
        setFx({ ...w.fx, bars: action.bars as number });
        return;
      case 'query': {
        const q = action.query as api.LibraryQuery;
        const path = (action.at as string | undefined) ?? deck.current;
        live({ ...play(w.lists, null, null, path), query: q });
        return;
      }
      default:
        actFx(action);
    }
  }

  /** The live effects' half of `act`. */
  function actFx(a: Args) {
    const f = w.fx;
    const flip = (on: unknown, was: boolean) => (on === null || on === undefined ? !was : (on as boolean));
    switch (a.kind) {
      case 'speed':
        return setFx({ ...f, speed: a.speed as number });
      case 'transition':
        return setFx({ ...f, transition: a.seconds as number });
      case 'strobe_rate':
        return setFx({ ...f, strobe_rate: a.rate as number });
      case 'strobe_intensity':
      case 'brightness':
      case 'hue':
      case 'trails':
      case 'sensitivity':
        return setFx({ ...f, [a.kind]: a.value as number });
      case 'strobe_style':
        return setFx({ ...f, strobe_style: a.style as fx.StrobeStyle });
      case 'sync':
        return setFx({ ...f, sync: a.source as fx.Sync });
      case 'blackout_fade':
        return setFx({ ...f, blackout_fade: a.seconds as number });
      case 'freeze':
      case 'strobe':
      case 'blackout':
      case 'punch':
      case 'punch_on_beat':
      case 'invert':
        return setFx({ ...f, [a.kind]: flip(a.on, f[a.kind as 'freeze']) });
      case 'mirror': {
        const order: fx.Mirror[] = ['off', 'x', 'y', 'quad'];
        return setFx({ ...f, mirror: (a.mode as fx.Mirror | null) ?? order[(order.indexOf(f.mirror) + 1) % order.length] });
      }
      case 'bpm':
        return setFx({ ...f, bpm: a.bpm as number });
      case 'fx_reset':
        return setFx({ ...F.FX, bpm: f.bpm, linked: f.linked, sensitivity: f.sensitivity, hold: f.hold, bars: f.bars });
    }
  }

  return (cmd: string, args: Args = {}): unknown => {
    if (w.hang.includes(cmd)) return never;
    if (cmd in w.fail) throw w.fail[cmd];
    switch (cmd) {
      // The library.
      case 'presets':
        return w.entries;
      case 'library_index':
        return w.rows;
      case 'library_data':
        return w.data;
      case 'library_set': {
        const change = args.change as api.LibraryChange;
        const presets = { ...w.data.presets };
        for (const key of args.keys as string[]) {
          const m: api.Mine = { ...presets[key] };
          if (change.star !== undefined) m.star = change.star;
          if (change.hidden !== undefined) m.hidden = change.hidden;
          if (change.rating !== undefined) m.rating = change.rating || undefined;
          const tags = new Set([...(m.tags ?? []), ...(change.add_tags ?? [])]);
          for (const t of change.remove_tags ?? []) tags.delete(t);
          m.tags = [...tags];
          if (change.clear_overrides) delete m.overrides;
          if (change.overrides) m.overrides = { ...m.overrides, ...change.overrides };
          presets[key] = m;
        }
        w.data = { ...w.data, presets };
        void emit('library-changed', w.data);
        return w.data;
      }
      case 'presets_failed':
        return w.failed;
      case 'settings_problems':
        return w.problems;
      case 'recently_played':
        return w.recent;
      case 'open':
        live({ ...w.lists.deck, current: args.path as string });
        return { preset: null, report: { equations: [], shaders: [] } };
      case 'resume_state':
        return w.resume;

      // Playlists and the deck.
      case 'playlists':
        return w.lists;
      case 'deck_items':
        return w.deckItems ?? w.lists.playlists.find((p) => p.id === w.lists.deck.playlist)?.items.map((i) => i.path) ?? [];
      case 'act':
        act(args.action as Args);
        return null;
      case 'playlist_create': {
        const id = `p-${w.lists.playlists.length + 1}`;
        return lists({ ...w.lists, playlists: [...w.lists.playlists, { id, name: args.name as string, items: [], kind: 'manual', query: null, settings: F.WARM_UP.settings }] });
      }
      case 'smart_playlist_save': {
        const id = `s-${w.lists.playlists.length + 1}`;
        const p: pl.Playlist = { id, name: args.name as string, items: [], kind: 'smart', query: args.query as api.LibraryQuery, settings: F.WARM_UP.settings, starter: (args.starter as string | null) ?? null };
        lists({ ...w.lists, playlists: [...w.lists.playlists, p] });
        return id;
      }
      case 'playlist_rename':
        return changeList(args.id as string, (p) => ({ ...p, name: args.name as string }));
      case 'playlist_delete':
        return lists({ ...w.lists, playlists: w.lists.playlists.filter((p) => p.id !== args.id) });
      case 'playlist_add':
        return changeList(args.id as string, (p) => {
          const items = [...p.items];
          items.splice((args.at as number | null) ?? items.length, 0, itemFor(args.path as string));
          return { ...p, items };
        });
      case 'playlist_remove':
        return changeList(args.id as string, (p) => ({ ...p, items: p.items.filter((_, i) => i !== args.index) }));
      case 'playlist_move_item':
        return changeList(args.id as string, (p) => {
          const items = [...p.items];
          const [moved] = items.splice(args.from as number, 1);
          items.splice(args.to as number, 0, moved);
          return { ...p, items };
        });
      case 'playlist_move': {
        const all = [...w.lists.playlists];
        const from = all.findIndex((p) => p.id === args.id);
        const [moved] = all.splice(from, 1);
        all.splice(args.to as number, 0, moved);
        return lists({ ...w.lists, playlists: all });
      }
      case 'playlist_settings':
        return changeList(args.id as string, (p) => ({ ...p, settings: args.settings as pl.PlaylistSettings }));
      case 'playlist_set_query':
        return changeList(args.id as string, (p) => ({ ...p, query: args.query as api.LibraryQuery }));
      case 'playlist_export': {
        const p = w.lists.playlists.find((x) => x.id === args.id);
        return { file_name: `${p?.name ?? 'playlist'}.json`, text: JSON.stringify(p ?? {}) };
      }
      case 'playlist_import':
        return w.lists;

      // Live.
      case 'fx_state':
        return w.fx;
      case 'link_state':
        return { ...w.link, at: Date.now() };
      case 'link_enable':
        w.link = args.on ?{ ...F.LINK, at: Date.now() } : { ...F.LINK_OFF, at: Date.now() };
        return w.link;
      case 'link_set_one':
      case 'link_reset_one':
      case 'link_nudge':
        return { ...w.link, at: Date.now() };
      case 'link_sync':
        w.link = { ...w.link, every: { every: args.every as number, unit: args.unit as link.Unit } };
        return w.link;
      case 'output_status':
        return w.output;
      case 'output_open':
        w.output = { display: w.displays.find((d) => d.id === args.id) ?? w.displays[w.displays.length - 1], size: [1920, 1080] };
        void emit('output', w.output);
        return w.output;
      case 'output_close':
        w.output = F.OUTPUT_OFF;
        void emit('output', w.output);
        return w.output;
      case 'displays':
        return w.displays;
      case 'live_start':
        return w.start;
      case 'start_preset':
        return null;

      // The preview and audio.
      case 'stats':
        return w.stats;
      case 'levels':
        return w.levels.map((l) => Math.max(0, Math.min(1, l * (0.75 + Math.random() * 0.5)))) as [number, number];
      case 'place_bench':
      case 'set_previews':
      case 'test_sound':
        return null;
      case 'previews':
        return new ArrayBuffer(0);
      case 'audio_sources':
        return w.sources;
      case 'listening':
        return w.heard;
      case 'inputs':
        return w.sources.sources.filter((s) => s.id.kind === 'device').map((s) => ({ name: s.name, channels: s.channels }));
      case 'listen_to':
        return (args.source as api.SourceId | undefined)?.kind === 'system' ? 'Everything the Mac plays' : String((args.name as string | undefined) ?? 'Ableton Live 12');

      // The pack, settings, privacy, updates.
      case 'pack_status':
        return w.pack;
      case 'pack_download':
      case 'pack_add':
        return null;
      case 'quality_get':
        return w.quality;
      case 'quality_set':
        w.quality = { ...w.quality, chosen: args.level as api.QualityLevel, effective: args.level === 'auto' ? 'high' : (args.level as Exclude<api.QualityLevel, 'auto'>), reason: args.level === 'auto' ? F.QUALITY.reason : 'Chosen in Settings' };
        return w.quality;
      case 'reduced_motion':
        return w.motion;
      case 'reduced_motion_set':
        w.motion = args.on === null ? F.MOTION : { reduced: args.on as boolean, system: false };
        return w.motion;
      case 'flash_warning_understood':
        return w.flashUnderstood;
      case 'flash_warning_understand':
        w.flashUnderstood = true;
        return null;
      case 'first_run':
        return w.firstRun;
      case 'first_run_done':
        w.firstRun = false;
        return null;
      case 'crash_reports':
        return w.crashes;
      case 'crash_report_open':
        w.crashes = w.crashes.map((c) => (c.id === args.id ? { ...c, sent: true } : c));
        return null;
      case 'crash_reports_enabled':
        return w.crashesEnabled;
      case 'crash_reports_enable':
        w.crashesEnabled = args.on as boolean;
        return null;
      case 'update_check':
        return w.update;
      case 'update_install':
        return never;
    }
    // Plugins (the opener, the webview's drag and drop) have nothing to say here.
    if (cmd.startsWith('plugin:')) return null;
    console.warn(`[stories] no fixture for the command "${cmd}"`, args);
    return null;
  };
}

/** Put a fresh app behind the page for one story; returns what takes it away again. */
export function install(over: Partial<World> = {}): () => void {
  const w = world(over);
  mockWindows('main');
  const answer = handler(w);
  mockIPC((cmd, payload) => answer(cmd, (payload ?? {}) as Args), { shouldMockEvents: true });
  return () => clearMocks();
}
