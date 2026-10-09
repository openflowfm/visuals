import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/** `engine::preset::Wave`. */
export interface Wave {
  values: Record<string, number>;
  init: string;
  frame: string;
  point: string;
}

/** `engine::preset::Shape`. */
export interface Shape {
  values: Record<string, number>;
  init: string;
  frame: string;
}

/** `engine::preset::Preset`: a `.milk` file read into its parts. */
export interface Preset {
  values: Record<string, number>;
  init: string;
  frame: string;
  vertex: string;
  waves: [Wave, Wave, Wave, Wave];
  shapes: [Shape, Shape, Shape, Shape];
  warp: string;
  comp: string;
}

export interface Entry {
  path: string;
  name: string;
  group: string;
}

export interface Problem {
  /** `init`, `frame`, `vertex`, `wave0.point`, `shape2.frame`, `warp`, `comp`… */
  stage: string;
  message: string;
  line: number | null;
}

export interface Report {
  /** Equations that would not compile; the bench keeps drawing the last preset. */
  equations: Problem[];
  /** Shaders that would not compile and draw MilkDrop's default instead. */
  shaders: Problem[];
}

export interface Input {
  name: string;
  channels: number;
}

export interface Stats {
  fps: number;
  cpu_ms: number;
}

/** `engine::runtime::Owner`: whose values a setting is. */
export type Owner = { list: 'base' } | { list: 'waves' | 'shapes'; index: number };

/** `engine::render::PREVIEW` (the base size), `PREVIEW_MAX` and `PREVIEWS`. */
export const PREVIEW = { width: 192, height: 108, maxWidth: 768, count: 15 };

export const presets = () => invoke<Entry[]>('presets');
/** One setting, live. False means the preset needs applying whole instead. */
export const setValue = (owner: Owner, key: string, value: number) => invoke<boolean>('set_value', { owner, key, value });
/** Keep the stage pictures `which` (`PREVIEWS` indices) at `width`×`height`; none stops them. */
export const setPreviews = (which: number[], width = PREVIEW.width, height = PREVIEW.height) => invoke<void>('set_previews', { which, width, height });
/** The latest stage pictures, packed with a header (`unpack` in previews.ts). */
export const previews = () => invoke<ArrayBuffer>('previews');
/** MilkDrop's default `warp` or `comp` shader as code to start from, with this
 * preset's decay, gamma and echo written in as numbers so it runs in any player
 * (`engine::shader::written_default`). */
export const defaultShader = (preset: Preset, which: 'warp' | 'comp') => invoke<string>('default_shader', { preset, which });
/** `library::Opened`: a preset opened on the preview, and what of it failed to compile. */
export interface Opened {
  preset: Preset;
  report: Report;
}
export const open = (path: string) => invoke<Opened>('open', { path });
export const apply = (preset: Preset) => invoke<Report>('apply', { preset });
export const placeBench = (r: { x: number; y: number; width: number; height: number }) => invoke<void>('place_bench', r);
export const inputs = () => invoke<Input[]>('inputs');
/** `size` (the input's channel count) tells apart inputs that share a name. */
export const listenTo = (name: string | null, left = 1, right = 2, size: number | null = null) => invoke<string>('listen_to', { name, size, left, right });

/** What the bench hears: the input and the two channels, counted from 1. */
export interface Heard {
  choice: { name: string; left: number; right: number; size: number } | null;
  channels: number;
  /** A tap is heard but macOS refused it other apps' sound, so it hears silence. */
  denied?: boolean;
}
export const listening = () => invoke<Heard>('listening');
/** The loudest sample in the left and right channels' latest windows, 0–1. */
export const levels = () => invoke<[number, number]>('levels');
export const stats = () => invoke<Stats>('stats');

/** `listen::SourceId`: an app's sound (a running DAW…), everything the Mac plays, or an input device. */
export type SourceId = { kind: 'app'; bundle: string } | { kind: 'system' } | { kind: 'device'; name: string; size: number };

/** `listen::Source`: something to listen to, as the source picker names it. */
export interface Source {
  id: SourceId;
  name: string;
  channels: number;
}

/** `listen::AudioSources`. */
export interface AudioSources {
  /** Apps and the whole Mac can be listened to (a Core Audio process tap, macOS 14.4+). */
  taps: boolean;
  sources: Source[];
}

export const audioSources = () => invoke<AudioSources>('audio_sources');
/** Listen to `source`, channels `left` and `right` counted from 1. Resolves to the source's name. */
export const listenToSource = (source: SourceId, left = 1, right = 2) => invoke<string>('listen_to', { source, left, right });

/** True until the welcome flow has been finished or skipped once. */
export const firstRun = () => invoke<boolean>('first_run');
/** The welcome flow is done: `firstRun` reads false from now on. */
export const firstRunDone = () => invoke<void>('first_run_done');

/** `updater::Update`: a newer version, and what's new in it. */
export interface Update {
  version: string;
  notes: string;
  date: string | null;
}
/** A newer version on this build's channel, or null when this one is the latest. */
export const updateCheck = () => invoke<Update | null>('update_check');
/** Download and install the update `updateCheck` found, then relaunch. */
export const updateInstall = () => invoke<void>('update_install');

/** Play (or stop) the test sound into the engine, as if it were heard. */
export const testSound = (on: boolean) => invoke<void>('test_sound', { on });

/** `engine::index::Level`. */
export type Level = 'low' | 'mid' | 'high';

/** `engine::index::Look`: what a preset looks like, measured from its pictures. */
export interface Look {
  /** Dominant hues in degrees, the strongest first; empty when it's grey. */
  hues: number[];
  /** Mean luma, 0–1. */
  brightness: number;
  /** Mean block motion per step; null when there was nothing to follow. */
  speed: number | null;
  /** Mean frame difference per step, luma 0–255. */
  intensity: number;
  brightness_level: Level;
  speed_level: Level;
  intensity_level: Level;
}

/** `catalog::Row`: one preset in the library, as its index has it. */
export interface LibraryRow {
  /** Folder-relative, `/`-separated (`cream-of-the-crop/Dancer/…/x.milk`); what `LibraryData` is keyed by. */
  key: string;
  /** The file, to `open`. */
  path: string;
  /** SHA-256 of the file in hex; empty when no index lists it. */
  hash: string;
  style: string;
  sub_style: string | null;
  /** Case-folded, originals first; `unknown` when the name doesn't credit one. */
  authors: string[];
  title: string;
  /** A URL for an `<img>` (`thumb:` scheme); null when there's none. */
  thumbnail: string | null;
  /** Null when it hasn't been drawn. */
  look: Look | null;
  /** From the bundled starter set rather than the presets folder. */
  starter: boolean;
}

/** Every preset in the library (the starter set and the presets folder, once each), sorted by key. */
export const libraryIndex = () => invoke<LibraryRow[]>('library_index');

/** `userlib::Overrides`: the user's own values for a preset's automatic groups; one left out keeps the index's. */
export interface Overrides {
  style?: string;
  sub_style?: string;
  authors?: string[];
  title?: string;
  hues?: number[];
  brightness?: Level;
  speed?: Level;
  intensity?: Level;
}

/** `userlib::Mine`: what the user keeps about one preset; a field left out is false, empty or none. */
export interface Mine {
  hash?: string;
  star?: boolean;
  tags?: string[];
  /** Never played by random or auto-advance. */
  hidden?: boolean;
  /** 1–5 stars; left out when unrated. */
  rating?: number;
  overrides?: Overrides;
}

/** `userlib::LibraryData` (`library.json`): only the presets the user has touched, by key. */
export interface LibraryData {
  version: number;
  presets: Record<string, Mine>;
}

/** `userlib::Change`: made to each preset `librarySet` is given; a field left out changes nothing. */
export interface LibraryChange {
  star?: boolean;
  hidden?: boolean;
  /** 1–5 stars; 0 takes the rating off. */
  rating?: number;
  add_tags?: string[];
  remove_tags?: string[];
  /** Drop the preset's overrides before `overrides` is applied. */
  clear_overrides?: boolean;
  /** Values to set; the ones left out stay. */
  overrides?: Overrides;
}

export const libraryData = () => invoke<LibraryData>('library_data');
/** Make `change` to each preset at `keys`; resolves to the data after it, also sent as `LIBRARY_CHANGED_EVENT`. */
export const librarySet = (keys: string[], change: LibraryChange) => invoke<LibraryData>('library_set', { keys, change });

/** `userlib::CHANGED`: the user's library data changed; the payload is the whole `LibraryData`. */
export const LIBRARY_CHANGED_EVENT = 'library-changed';
export const onLibraryChanged = (f: (data: LibraryData) => void): Promise<UnlistenFn> => listen<LibraryData>(LIBRARY_CHANGED_EVENT, (e) => f(e.payload));

/** The library's groups, as its chips name them. */
export type LibraryGroup = 'style' | 'author' | 'colour' | 'speed' | 'intensity' | 'star' | 'tags';

/** A library filter: AND across groups, OR within one, and the search text. */
export interface LibraryQuery {
  groups: Partial<Record<LibraryGroup, string[]>>;
  text: string;
  /** Only presets among the last this many played, newest first. */
  recent?: number;
}

/** Save `query` as a smart playlist named `name`; resolves to its id, and a `lists` event follows. */
export const smartPlaylistSave = (name: string, query: LibraryQuery) => invoke<string>('smart_playlist_save', { name, query });

/** How much the renderer draws: chosen by the user, or `auto` to follow the machine. */
export type QualityLevel = 'auto' | 'low' | 'medium' | 'high';
/** `quality::Quality`: the level chosen, and the one in effect (what `auto` came to). */
export interface Quality {
  chosen: QualityLevel;
  effective: Exclude<QualityLevel, 'auto'>;
  /** One line on why it is at `effective`: what auto measured, or that it was chosen. */
  reason: string;
}
/** The render quality. A stub until its 0.9 lane (#101) lands: it never fails, and always says `{ chosen: 'auto', effective: 'high' }`. */
export const qualityGet = () => invoke<Quality>('quality_get');
/** Choose the render quality; resolves to it in effect. A stub until its 0.9 lane (#101) lands: it fails. */
export const qualitySet = (level: QualityLevel) => invoke<Quality>('quality_set', { level });

/** `access::Motion`: whether to calm the motion, and whether that came from macOS's own setting. */
export interface Motion {
  reduced: boolean;
  /** No choice made in the app: macOS's "Reduce motion" decides. */
  system: boolean;
}
export const reducedMotion = () => invoke<Motion>('reduced_motion');
/** Reduce motion (true), don't (false), or follow macOS (null). */
export const reducedMotionSet = (on: boolean | null) => invoke<Motion>('reduced_motion_set', { on });

/** `crash::Report`: a crash kept on this Mac. */
export interface CrashReport {
  id: string;
  /** Unix seconds. */
  when: number;
  summary: string;
  text: string;
  /** Already opened as an issue. */
  sent: boolean;
}
/** The crash reports kept on this Mac, unsent and sent. */
export const crashReports = () => invoke<CrashReport[]>('crash_reports');
/** Open a GitHub issue prefilled with the report, for the user to look over and submit; nothing goes to a server of ours. */
export const crashReportOpen = (id: string) => invoke<void>('crash_report_open', { id });
/** Whether crashes are kept to report. */
export const crashReportsEnabled = () => invoke<boolean>('crash_reports_enabled');
export const crashReportsEnable = (on: boolean) => invoke<void>('crash_reports_enable', { on });

/** `resume::Resume`: where the last session left off, to pick it up again. */
export interface Resume {
  playlist: string | null;
  index: number | null;
  current: string | null;
  source: SourceId | null;
}
/** Where the last session left off; null on a first run or when nothing was playing. */
export const resumeState = () => invoke<Resume | null>('resume_state');

/** Menu event: Check for Updates… was chosen. Listened to by #87. */
export const UPDATE_CHECK_EVENT = 'update-check';
/** Menu event: Welcome… was chosen. Listened to by #88. */
export const WELCOME_EVENT = 'welcome';
/** Menu event: Credits was chosen. Listened to by #86. */
export const CREDITS_EVENT = 'credits';
