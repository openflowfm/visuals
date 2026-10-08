import { invoke } from '@tauri-apps/api/core';

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
