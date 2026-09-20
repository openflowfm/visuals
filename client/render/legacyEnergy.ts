import { SOURCES, FIELD_MODES, FRACTAL_MODES, LIGHT_MODES, FORM_MODES, GLOW_MODES, SHADE_MODES, LENS_MODES, GRADE_MODES, SPREAD_MODES, type CircuitNode } from '../../protocol.ts';
import { SOURCE_VALUES } from './glsl/sources.ts';

export interface LegacyEnergyTarget { name: string; response: 'energy' | 'raw' }
export const SOURCE_RATE_MODES = new Set(['rings', 'grid', 'tunnel', 'plasma', 'spiral', 'sparks', 'checker', 'rays', 'traces']);
/** Old energy fan-out, used only while importing legacy graphs and response calibration. */
export function legacyEnergyTargets(node: Pick<CircuitNode, 'kind' | 'op'>): LegacyEnergyTarget[] {
  const modes = ({ source: SOURCES, field: FIELD_MODES, fractal: FRACTAL_MODES, light: LIGHT_MODES, form: FORM_MODES, glow: GLOW_MODES, shade: SHADE_MODES, lens: LENS_MODES, grade: GRADE_MODES, spread: SPREAD_MODES } as Partial<Record<CircuitNode['kind'], readonly string[]>>)[node.kind];
  const op = modes?.includes(node.op ?? '') ? node.op! : modes?.[0] ?? '';
  const targets: LegacyEnergyTarget[] = [];
  const energy = (...names: string[]) => targets.push(...names.map(name => ({ name, response: 'energy' as const })));
  const raw = (...names: string[]) => targets.push(...names.map(name => ({ name, response: 'raw' as const })));
  if (['source', 'field', 'fractal', 'light', 'form', 'glow', 'shade', 'colorway'].includes(node.kind)) energy('brightness', 'contrast');
  switch (node.kind) {
    case 'source':
      raw(...(SOURCE_VALUES[op as keyof typeof SOURCE_VALUES] ?? []));
      if (SOURCE_RATE_MODES.has(op)) energy('rate');
      if (op === 'strobe') energy('decay');
      break;
    case 'field':
      if (op === 'cells' || op === 'clouds') raw('weave');
      if (op === 'metaballs') energy('hardness');
      break;
    case 'fractal': energy('rate', 'interior-brightness'); break;
    case 'light': energy('intensity'); break;
    case 'form':
      energy('emission');
      if (['armillary', 'astrolabe', 'rosette', 'corolla', 'spindle', 'meridian', 'vault'].includes(op)) energy('core-brightness');
      break;
    case 'glow': energy('intensity'); if (op === 'neon') energy('overdrive'); break;
    case 'lens':
      if (['twist', 'ripple', 'slice'].includes(op)) energy('rate');
      if (op === 'ripple') energy('frequency');
      if (op === 'kaleido') energy('segment-offset');
      if (op === 'pixelate') energy('resolution-scale');
      break;
    case 'grade': if (op === 'invert') energy('division', 'decay'); break;
    case 'spread':
      if (op === 'bloom' || op === 'streak') energy('intensity');
      if (op === 'shift' || op === 'disperse') energy('separation');
      break;
  }
  return targets;
}
