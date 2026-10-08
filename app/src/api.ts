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
export const setPreviews = (which: number[], width = PREVIEW.width, height = PREVIEW.height) =>
  invoke<void>('set_previews', { which, width, height });
/** The latest stage pictures, packed with a header (`unpack` in previews.ts). */
export const previews = () => invoke<ArrayBuffer>('previews');
/** MilkDrop's default `warp` or `comp` shader as code to start from, with this
 * preset's decay, gamma and echo written in as numbers so it runs in any player
 * (`engine::shader::written_default`). */
export const defaultShader = (preset: Preset, which: 'warp' | 'comp') => invoke<string>('default_shader', { preset, which });
export const open = (path: string) => invoke<{ preset: Preset; report: Report }>('open', { path });
export const apply = (preset: Preset) => invoke<Report>('apply', { preset });
export const placeBench = (r: { x: number; y: number; width: number; height: number }) => invoke<void>('place_bench', r);
export const inputs = () => invoke<Input[]>('inputs');
/** `size` (the input's channel count) tells apart inputs that share a name. */
export const listenTo = (name: string | null, left = 1, right = 2, size: number | null = null) =>
  invoke<string>('listen_to', { name, size, left, right });

/** What the bench hears: the input and the two channels, counted from 1. */
export interface Heard {
  choice: { name: string; left: number; right: number; size: number } | null;
  channels: number;
}
export const listening = () => invoke<Heard>('listening');
/** The loudest sample in the left and right channels' latest windows, 0–1. */
export const levels = () => invoke<[number, number]>('levels');
export const stats = () => invoke<Stats>('stats');
