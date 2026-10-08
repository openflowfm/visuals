import { describe, expect, it } from 'vitest';
import converter from 'milkdrop-preset-converter';
import { forwardInputs, parenthesize, parenthesizePreset, uniformSamplers } from './hlsl.ts';

/**
 * The converter loses the operator of any binary expression whose left side is
 * another binary expression. Bracketing fixes it, so these pin two things: that
 * the brackets are where precedence already put them, and that the converter
 * then emits GLSL a driver will compile.
 */

describe('parenthesize', () => {
  it('brackets by precedence and keeps everything else', () => {
    expect(parenthesize('ret = a * 2.0 + a;')).toBe('ret = ((a * 2.0) + a);');
    expect(parenthesize('ret = a + b * c - d;')).toBe('ret = ((a + (b * c)) - d);');
    expect(parenthesize('x = -a*b + c;')).toBe('x = ((-a*b) + c);');
    expect(parenthesize('  float3 v = tex2D(s, uv).xyz * k + 1;  // note')).toBe(
      '  float3 v = ((tex2D(s, uv).xyz * k) + 1);  // note',
    );
  });

  it('brackets inside calls, indexing and ternaries', () => {
    expect(parenthesize('r = lerp(a, a*2+a, t);')).toBe('r = lerp(a, ((a*2)+a), t);');
    expect(parenthesize('r = x > 0.5 ? a + b + c : d;')).toBe('r = ((x > 0.5) ? ((a + b) + c) : d);');
  });

  it('copies through what is not an expression', () => {
    const source = [
      '#define GetX(uv) (uv.x*2+1)',
      'float3 shade(float3 c) { return c*0.5 + 0.5; }',
      'shader_body {',
      '  for (int i = 0; i < 4; i++) { ret += (float3)i * 0.1 + q1; }',
      '}',
    ].join('\n');
    expect(parenthesize(source)).toBe(
      [
        '#define GetX(uv) (uv.x*2+1)',
        'float3 shade(float3 c) { return ((c*0.5) + 0.5); }',
        'shader_body {',
        '  for (int i = 0; (i < 4); i++) { ret += (((float3)i * 0.1) + q1); }',
        '}',
      ].join('\n'),
    );
  });

  it('writes out the blur macros so they are bracketed too', () => {
    expect(parenthesize('ret = GetBlur2(uv + GetBlur1(uv).xy);')).toBe(
      'ret = (((tex2D(sampler_blur2,(uv + (((tex2D(sampler_blur1,uv).xyz*scale1) + bias1)).xy)).xyz*scale2) + bias2));',
    );
  });

  it('never drops a token, whatever it is handed', () => {
    for (const odd of ['a = (b + ;', ') ) ( (', 'x = y ? z;', 'float3 a, b = c + d * e;']) {
      expect(parenthesize(odd).replace(/[()\s]/g, '')).toBe(odd.replace(/[()\s]/g, ''));
    }
  });

  it('is what the converter needs to translate operators correctly', async () => {
    const shader = 'shader_body {\n float3 a = tex2D(sampler_main, uv).xyz;\n ret = a * 2.0 - a + GetBlur1(uv) * 0.5;\n}';
    expect(String(await converter.convertShader(shader))).toContain('&&');
    const fixed = String(await converter.convertShader(parenthesize(shader)));
    expect(fixed).not.toContain('&&');
    expect(fixed).toMatch(/\(a \* vec3 \(2\.0+\)\) - a\)/);
  });
});

describe('forwardInputs', () => {
  it("passes main's locals into the converter's function", async () => {
    const comp = String(await converter.convertShader('shader_body {\n ret = hue_shader * rad + tex2D(sampler_main, uv_orig).xyz * ang;\n}'));
    const fixed = forwardInputs(comp, 'comp');
    expect(fixed).toContain('main_shader_sentinel(vec2 uv, vec2 uv_orig, float rad, float ang, vec3 hue_shader)');
    expect(fixed).toContain('main_shader_sentinel(uv, uv_orig, rad, ang, hue_shader)');
    expect(forwardInputs(comp, 'warp')).toContain('main_shader_sentinel(uv, rad, ang)');
  });
});

describe('uniformSamplers', () => {
  it('declares a bare sampler as a uniform and leaves declared ones alone', () => {
    expect(uniformSamplers('sampler2D sampler_clouds;\nuniform sampler2D sampler_main;\n  sampler3D sampler_vol;')).toBe(
      'uniform sampler2D sampler_clouds;\nuniform sampler2D sampler_main;\n  uniform sampler3D sampler_vol;',
    );
  });
});

describe('parenthesizePreset', () => {
  it('rewrites the shader lines and leaves the rest of the file alone', () => {
    const milk = ['[preset00]', 'zoom=1.0', 'warp_1=`shader_body {', 'warp_2=`ret = a*b+c;', 'warp_3=`}', 'per_frame_1=x=a*b+c;', 'comp_1=`ret = d-e+f;'].join('\n');
    expect(parenthesizePreset(milk)).toBe(
      ['[preset00]', 'zoom=1.0', 'warp_1=`shader_body {', 'warp_2=`ret = ((a*b)+c);', 'warp_3=`}', 'per_frame_1=x=a*b+c;', 'comp_1=`ret = ((d-e)+f);'].join('\n'),
    );
  });
});
