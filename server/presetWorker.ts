import { parentPort } from 'node:worker_threads';
import converter from 'milkdrop-preset-converter';

/**
 * One `.milk` file into the JSON Butterchurn draws, off the server's thread.
 *
 * A worker rather than a call because the shader half of the converter is an
 * Emscripten build of a whole HLSL parser, and a preset it chokes on can spin.
 * The server owns a clock that the wall follows, so anything that can hang
 * belongs somewhere it can be terminated. See `presets.ts`.
 */
parentPort!.on('message', async ({ text }: { text: string }) => {
  try {
    const preset = await converter.convertPreset(text);
    if (!preset?.baseVals || !Array.isArray(preset.shapes) || !Array.isArray(preset.waves)) {
      throw new Error('the converter returned an incomplete preset');
    }
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
