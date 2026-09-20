import { it, expect } from 'vitest';
import { chromium } from 'playwright';
import type { CircuitNode } from '../../protocol.ts';
import { NODE_SPECS, compileCircuit, modulatesModes } from './circuit.ts';
import { TRACK_SHADERS } from './shaders.ts';

/** A wrong colour fallback is a GLSL type error; string snapshots cannot detect it. */
it('compiles every colour node mode, including driven modes, on WebGL2', async () => {
  const cases: { name: string; source: string }[] = [];
  for (const [kind, spec] of Object.entries(NODE_SPECS)) {
    const outlet = spec.outlets.find(port => port.kind === 'c');
    if (!outlet) continue;
    for (const mode of spec.modes ?? [{ name: '' }]) {
      const node = { id: 's', kind, op: mode.name, x: 0, y: 0 } as CircuitNode;
      for (const driven of modulatesModes(node.kind) ? [false, true] : [false]) {
        const built = compileCircuit({
          nodes: [node, { id: 'v', kind: 'value', value: 0.4, x: 0, y: 0 }, { id: 'o', kind: 'out', x: 1, y: 0 }],
          cords: [{ from: `s/${outlet.name}`, to: 'o/c' }, ...(driven ? [{ from: 'v/n', to: 's/mode' }] : [])],
        });
        expect(built.error).toBeNull();
        cases.push({ name: `${kind}/${mode.name}/${driven ? 'driven' : 'fixed'}`, source: built.source! });
      }
    }
  }
  cases.push(...Object.entries(TRACK_SHADERS).map(([name, source]) => ({ name: `track/${name}`, source })));
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage();
    const failures = await page.evaluate(cases => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) throw new Error('WebGL2 is unavailable');
      return cases.flatMap(({ name, source }) => {
        const shader = gl.createShader(gl.FRAGMENT_SHADER)!;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        const error = gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? null : gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        return error ? [{ name, error }] : [];
      });
    }, cases);
    expect(failures).toEqual([]);
  } finally {
    await browser.close();
  }
}, 30_000);
