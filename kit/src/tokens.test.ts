import { describe, expect, it } from 'vitest';
import { background, backdrop, cssColor, over, ring, shadow, splitAppearance, swatchName, textStyleName, tokensCss, tokensOf, weightOf, type SColor, type SDocument } from './tokens.ts';

const c = (red: number, green: number, blue: number, alpha = 1): SColor => ({ red, green, blue, alpha });
const fill = (color: SColor, blendMode = 0, opacity = 1) => ({ isEnabled: true, fillType: 0, color, contextSettings: { blendMode, opacity } });

describe('splitAppearance', () => {
  it('finds the appearance segment, and whether it is vibrant', () => {
    expect(splitAppearance('Content Area/Light/Controls/On')).toEqual({ appearance: 'light', vibrant: false, parts: ['Content Area', 'Controls', 'On'] });
    expect(splitAppearance('Labels/Light Vibrant (use plus darker)/1 Primary')).toMatchObject({ appearance: 'light', vibrant: true, parts: ['Labels', '1 Primary'] });
    expect(splitAppearance('System Colors/Dark (use plus lighter)/8 Blue')).toMatchObject({ appearance: 'dark', vibrant: true });
    expect(splitAppearance('Window Backgrounds/Dark Background')).toMatchObject({ appearance: 'dark', parts: ['Window Backgrounds', 'Background'] });
    expect(splitAppearance('Global/Focus Ring')).toMatchObject({ appearance: 'any' });
  });
});

describe('swatchName', () => {
  it("uses AppKit's names for labels, fills and system colours", () => {
    expect(swatchName('Labels/Light/1 Primary')?.token).toBe('--mac-label');
    expect(swatchName('Labels/Dark/2 Secondary')?.token).toBe('--mac-secondary-label');
    expect(swatchName('Fills/Light/4 Quatenary')?.token).toBe('--mac-quaternary-fill');
    expect(swatchName('Labels/Light Vibrant (use plus darker)/3 Tertiary')?.token).toBe('--mac-vibrant-tertiary-label');
    expect(swatchName('System Colors/Light/8 Blue')?.token).toBe('--mac-blue');
    expect(swatchName('Window Backgrounds/Light Background')?.token).toBe('--mac-window-background');
    expect(swatchName('Separators/Light')?.token).toBe('--mac-separator');
  });

  it("leaves out the kit's own bookkeeping colours and the plain black and white", () => {
    expect(swatchName('x. Kit/Nested Symbol BG Dark')).toBeNull();
    expect(swatchName('Grays/Light/Black')).toBeNull();
    expect(swatchName('Grays/Light/Grey')?.token).toBe('--mac-gray');
  });
});

describe('colour', () => {
  it('writes rgb() with an alpha only when translucent', () => {
    expect(cssColor([0, 0.5333, 1, 1])).toBe('rgb(0 136 255)');
    expect(cssColor([0, 0, 0, 0.1])).toBe('rgb(0 0 0 / 0.1)');
  });

  it('composites plus darker as Core Graphics does: over an opaque backdrop, cs + cb − 1', () => {
    // 3% black, plus darker, over #0088ff: each channel drops by 0.03.
    const out = over([0, 0.5333, 1, 1], [0, 0, 0, 0.03], 16);
    expect(out.map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 0.503, 0.97, 1]);
  });

  it('composites plus lighter as an add, and normal as source-over', () => {
    expect(over([0.2, 0.2, 0.2, 1], [0.1, 0.1, 0.1, 0.1], 17)).toEqual([0.30000000000000004, 0.30000000000000004, 0.30000000000000004, 1]);
    expect(over([0, 0, 0, 0], [0.5, 0, 0, 0.5], 0)).toEqual([0.5, 0, 0, 0.5]);
  });
});

describe('layer styles', () => {
  it('flattens stacked fills, blend modes and the style opacity into one colour', () => {
    expect(background({ fills: [fill(c(0, 0.5333, 1)), fill(c(0, 0, 0, 0.03), 16)] })).toBe('rgb(0 128.3 247.4)');
    expect(background({ fills: [fill(c(0, 0, 0, 0.1))], contextSettings: { opacity: 0.5 } })).toBe('rgb(0 0 0 / 0.05)');
    expect(background({ fills: [] })).toBeNull();
  });

  it('draws borders as rings: inside inset, outside outset, top border first', () => {
    const border = (position: number, thickness: number) => ({ ...fill(c(0, 0.5333, 1)), thickness, position });
    expect(ring({ borders: [border(2, 3.5), border(1, 1)] })).toBe('inset 0 0 0 1px rgb(0 136 255), 0 0 0 3.5px rgb(0 136 255)');
  });

  it('writes shadows as box-shadow, inner shadows inset', () => {
    const s = { isEnabled: true, color: c(0, 0, 0, 0.05), offsetX: 0, offsetY: 3, blurRadius: 36, spread: 0 };
    expect(shadow({ shadows: [s], innerShadows: [{ ...s, offsetY: 1 }] })).toBe('inset 0px 1px 36px 0px rgb(0 0 0 / 0.05), 0px 3px 36px 0px rgb(0 0 0 / 0.05)');
  });

  it("writes a background blur as backdrop-filter at half Sketch's radius, glass flagged", () => {
    expect(backdrop({ blurs: [{ isEnabled: true, type: 3, radius: 60, saturation: 1.45 }] })).toEqual({ value: 'blur(30px) saturate(1.45)', glass: false });
    expect(backdrop({ blurs: [{ isEnabled: true, type: 4, radius: 30 }] })?.glass).toBe(true);
  });
});

describe('text styles', () => {
  it('names them by style, emphasis and leading', () => {
    expect(textStyleName('06 Body/Default')).toBe('--mac-font-body');
    expect(textStyleName('01 LargeTitle/Emphasized')).toBe('--mac-font-large-title-emphasized');
    expect(textStyleName('Tight Leading/10 Caption1/Default')).toBe('--mac-font-caption1-tight');
    expect(textStyleName('Secondary Style')).toBeNull();
  });

  it("reads SF Pro's weights from the PostScript name", () => {
    expect(weightOf('SFPro-Regular')).toBe(400);
    expect(weightOf('SFPro-Semibold')).toBe(590);
    expect(weightOf('SFPro-Heavy')).toBe(860);
  });
});

describe('tokensCss', () => {
  const doc: SDocument = {
    sharedSwatches: {
      objects: [
        { name: 'Labels/Light/1 Primary', value: c(0, 0, 0, 0.85) },
        { name: 'Labels/Dark/1 Primary', value: c(1, 1, 1) },
      ],
    },
    layerTextStyles: {
      objects: [
        {
          name: '06 Body/Default',
          value: { textStyle: { encodedAttributes: { MSAttributedStringFontAttribute: { attributes: { name: 'SFPro-Regular', size: 13 } }, paragraphStyle: { maximumLineHeight: 16 } } } },
        },
      ],
    },
    layerStyles: { objects: [{ name: 'Content Area/Light/Controls/Active, On, 01 - Idle', value: { fills: [fill(c(0, 0.5333, 1))] } }] },
  };
  const css = tokensCss(tokensOf(doc), 'a kit');

  it('puts light values on :root and dark ones under the preference and data-appearance', () => {
    expect(css).toMatch(/:root,\n\[data-appearance='light'\] \{[^}]*--mac-label: rgb\(0 0 0 \/ 0.85\);/);
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\n {2}:root:not\(\[data-appearance='light'\]\) \{[^}]*--mac-label: rgb\(255 255 255\);/);
    expect(css).toMatch(/\[data-appearance='dark'\] \{[^}]*--mac-label: rgb\(255 255 255\);/);
  });

  it('writes the type scale as font shorthands and layer styles by their path', () => {
    expect(css).toContain('--mac-font-body: 400 13px/16px var(--mac-font-family);');
    expect(css).toContain('--mac-content-area-controls-active-on-idle-bg: rgb(0 136 255);');
  });
});
