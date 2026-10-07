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

/** `engine::render::PREVIEW` and `PREVIEWS`. */
export const PREVIEW = { width: 192, height: 108, count: 15 };

export const presets = () => invoke<Entry[]>('presets');
/** One setting, live. False means the preset needs applying whole instead. */
export const setValue = (owner: Owner, key: string, value: number) => invoke<boolean>('set_value', { owner, key, value });
export const setPreviews = (on: boolean) => invoke<void>('set_previews', { on });
export const previews = () => invoke<ArrayBuffer>('previews');
export const open = (path: string) => invoke<{ preset: Preset; report: Report }>('open', { path });
export const apply = (preset: Preset) => invoke<Report>('apply', { preset });
export const placeBench = (r: { x: number; y: number; width: number; height: number }) => invoke<void>('place_bench', r);
export const inputs = () => invoke<Input[]>('inputs');
export const listenTo = (name: string | null, left = 1, right = 2) => invoke<string>('listen_to', { name, left, right });
export const stats = () => invoke<Stats>('stats');
