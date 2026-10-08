import { parentPort } from 'node:worker_threads';
import converter from 'milkdrop-preset-converter';
import { parenthesizePreset, repairShader } from './hlsl.ts';

/**
 * One `.milk` file into the JSON Butterchurn draws, as the BlackHole-era app
 * converted it: brackets and shader repairs from `hlsl.ts`, then
 * `milkdrop-preset-converter`.
 *
 * A worker rather than a call because the shader half of the converter is an
 * Emscripten build of a whole HLSL parser, and a preset it chokes on can spin;
 * `bench.ts` terminates it after 10 s.
 */
parentPort!.on('message', async ({ text }: { text: string }) => {
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
    parentPort!.postMessage({ ok: true, json: JSON.stringify(preset) });
  } catch (error) {
    parentPort!.postMessage({
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
});
