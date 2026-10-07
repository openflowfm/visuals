// One `.milk` into the JSON Butterchurn draws: `server/presetWorker.ts`, in the
// page. A worker for the same reason: the converter's HLSL half is an Emscripten
// build of a whole parser, and a preset it chokes on can spin.
import converter from 'milkdrop-preset-converter';
import { parenthesizePreset, repairShader } from '../../../server/hlsl.ts';

export type Converted = { ok: true; json: string } | { ok: false; reason: string };

const scope = self as unknown as { onmessage: ((e: MessageEvent<{ text: string }>) => void) | null; postMessage(m: Converted): void };

scope.onmessage = async ({ data: { text } }) => {
  try {
    // Bracketed first: the converter mistranslates unbracketed operator chains.
    const preset = await converter.convertPreset(parenthesizePreset(text));
    if (!preset?.baseVals || !Array.isArray(preset.shapes) || !Array.isArray(preset.waves)) {
      throw new Error('the converter returned an incomplete preset');
    }
    if (preset.warp) preset.warp = repairShader(preset.warp, 'warp');
    if (preset.comp) preset.comp = repairShader(preset.comp, 'comp');
    // Syntax only. Whether the shaders compile is the GPU's answer, on load.
    for (const part of [preset, ...preset.shapes, ...preset.waves]) {
      for (const key of ['init_eqs_str', 'frame_eqs_str', 'pixel_eqs_str', 'point_eqs_str']) {
        if (part[key]) new Function('a', `${part[key]}; return a;`);
      }
    }
    scope.postMessage({ ok: true, json: JSON.stringify(preset) });
  } catch (error) {
    scope.postMessage({ ok: false, reason: error instanceof Error ? error.message : String(error) });
  }
};
