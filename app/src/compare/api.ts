import { invoke } from '@tauri-apps/api/core';
import type { Preset, Report } from '../api.ts';

/** `compare::Listed`: a preset of the pack, with the key its verdict is kept under. */
export interface Listed {
  path: string;
  name: string;
  group: string;
  id: string;
}

export type Verdict = 'approve' | 'reject';

/** `compare::Approval`, which is `harness/compareReport.ts`'s `Approval`. */
export interface Approval {
  verdict: Verdict | null;
  note: string;
  score: number | null;
  at: string;
}

export interface Start {
  compare: boolean;
  preset: string | null;
}

export const presets = () => invoke<Listed[]>('compare_presets');
export const approvals = () => invoke<{ file: string; items: Record<string, Approval> }>('compare_approvals');
export const judge = (id: string, verdict: Verdict | null, note: string) => invoke<Approval | null>('compare_judge', { id, verdict, note });
/** Open on the bench with the shared seed (`compare::SEED`). */
export const open = (path: string) => invoke<{ preset: Preset; report: Report }>('compare_open', { path });
/** Sample rate (f32 LE), then mono, left and right byte windows of 1024. */
export const audio = () => invoke<ArrayBuffer>('compare_audio');
export const source = (path: string) => invoke<ArrayBuffer>('compare_source', { path });
export const cached = (converter: string, hash: string) => invoke<string | null>('compare_cached', { converter, hash });
export const cache = (converter: string, hash: string, json: string) => invoke<void>('compare_cache', { converter, hash, json });
export const start = () => invoke<Start>('compare_start');

/** The seed both sides open presets with: `compare::SEED`, the recorded bench's `--seed 1`. */
export const SEED = 1n;
/** The engine's noise textures come from this seed (`Renderer::new`); `harness/compare.ts`'s `NOISE_SEED`. */
export const NOISE_SEED = 0x5eedn;
/** The size the engine draws presets at (`bench::DRAW`). Butterchurn draws at it too. */
export const DRAW = { width: 1920, height: 1080 };
