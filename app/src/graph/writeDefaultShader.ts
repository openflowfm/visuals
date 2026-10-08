import * as api from '../api.ts';
import type { Preset } from '../api.ts';
import type { Stage } from '../stages.ts';

/** "Write my own": a shader stage's code set to MilkDrop's default, as the engine
 * writes it out, so it can be edited from there. */
export function writeDefaultShader(preset: Preset, stage: Stage, onChange: (next: Preset) => void): void {
  const which = stage.id as 'warp' | 'comp';
  api.defaultShader(preset, which).then((code) => onChange({ ...preset, [which]: code }), console.error);
}
