import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { trackingAt } from './fonts.ts';
import { backgroundFor, buildScene, loadKit, type SLayer } from './scene.ts';

const frame = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const black = (alpha: number) => ({ red: 0, green: 0, blue: 0, alpha });
const fill = (alpha: number) => ({ isEnabled: true, fillType: 0, color: black(alpha), gradient: { gradientType: 0, from: '{0.5, 0}', to: '{0.5, 1}', elipseLength: 0, stops: [] } });

/** A one-page document with a knob symbol and a switch that places it. */
function kitWith(layers: SLayer[]) {
  const dir = mkdtempSync(join(tmpdir(), 'kit-'));
  mkdirSync(join(dir, 'pages'));
  writeFileSync(join(dir, 'document.json'), JSON.stringify({ fontReferences: [] }));
  writeFileSync(join(dir, 'pages', 'p.json'), JSON.stringify({ layers }));
  return loadKit(dir);
}

const knob: SLayer = {
  _class: 'symbolMaster',
  do_objectID: 'knob-master',
  symbolID: 'KNOB',
  name: 'Parts/Knob',
  frame: frame(500, 500, 20, 20),
  layers: [{ _class: 'oval', do_objectID: 'dot', name: 'Dot', frame: frame(0, 0, 20, 20), style: { fills: [fill(1)] } }],
};

const toggle: SLayer = {
  _class: 'symbolMaster',
  do_objectID: 'toggle-master',
  symbolID: 'TOGGLE',
  name: 'Toggles/Dark/Content Area/3 Rg/On',
  frame: frame(100, 200, 54, 24),
  clippingBehavior: 2,
  style: { fills: [fill(0.1)], corners: { radii: [3.4e38], style: 0, smoothing: 0.6 }, contextSettings: { blendMode: 16 } },
  layers: [
    { _class: 'symbolInstance', do_objectID: 'inst', name: 'Knob', symbolID: 'KNOB', frame: frame(30, 2, 20, 20), style: { contextSettings: { opacity: 0.5 } } },
    {
      _class: 'text',
      do_objectID: 'label',
      name: 'Label',
      frame: frame(0, 0, 40, 15),
      attributedString: {
        string: 'On',
        attributes: [{ location: 0, length: 2, attributes: { MSAttributedStringFontAttribute: { attributes: { name: 'SFPro-Semibold', size: 13 } }, kerning: 0.5 } }],
      },
    },
    { _class: 'rectangle', do_objectID: 'hidden', name: 'Hidden', isVisible: false, frame: frame(0, 0, 1, 1) },
  ],
};

describe('buildScene', () => {
  const kit = kitWith([knob, toggle]);
  const scene = buildScene(kit, kit.byName.get(toggle.name)!, backgroundFor(toggle.name));

  it('puts the symbol at the origin, on its appearance’s window background', () => {
    expect(scene.root.matrix).toEqual([1, 0, 0, 1, 0, 0]);
    expect(scene.background).toEqual([30 / 255, 30 / 255, 30 / 255, 1]);
    expect(backgroundFor('Toggles/Light/x')).toEqual([1, 1, 1, 1]);
  });

  it('keeps the root’s fills, outline, clipping and blend mode', () => {
    expect(scene.root.fills).toEqual([{ kind: 'color', color: [0, 0, 0, 0.1], opacity: 1, blend: 0 }]);
    expect(scene.root.clip).toBe(true);
    expect(scene.root.blend).toBe(16);
    expect(scene.root.path).toContain('a12 12');
  });

  it('expands an instance into its master, placed by the instance and with its own opacity', () => {
    const [inst] = scene.root.children;
    expect(inst.matrix).toEqual([1, 0, 0, 1, 30, 2]);
    expect(inst.opacity).toBe(0.5);
    expect(inst.children[0].name).toBe('Dot');
    expect(inst.children[0].path).toContain('A10 10');
  });

  it('leaves hidden layers out', () => {
    expect(scene.root.children.map((c) => c.name)).toEqual(['Knob', 'Label']);
  });

  it('draws text it has no font for with the system font, and says so', () => {
    const run = scene.root.children[1].text!.runs[0];
    expect(run).toMatchObject({ text: 'On', family: 'system-ui', weight: 590, size: 13, kerning: 0.5 });
    expect(scene.warnings.some((w) => w.startsWith('font SFPro-Semibold not embedded'))).toBe(true);
  });

  it('applies a text override from the instance', () => {
    const withOverride = kitWith([
      toggle,
      {
        _class: 'symbolMaster',
        do_objectID: 'outer',
        symbolID: 'OUTER',
        name: 'Outer',
        frame: frame(0, 0, 54, 24),
        layers: [{ _class: 'symbolInstance', do_objectID: 'i', name: 'Toggle', symbolID: 'TOGGLE', frame: frame(0, 0, 54, 24), overrideValues: [{ overrideName: 'label_stringValue', value: 'Off' }] }],
      },
    ]);
    const s = buildScene(withOverride, withOverride.byName.get('Outer')!, null);
    const label = s.root.children[0].children.find((c) => c.name === 'Label')!;
    expect(label.text!.runs[0].text).toBe('Off');
  });
});

describe('trackingAt', () => {
  const t = { sizes: [10, 20], values: [0.01, -0.02] };
  it('interpolates between sizes and holds at the ends, in points', () => {
    expect(trackingAt(t, 15)).toBeCloseTo(-0.005 * 15);
    expect(trackingAt(t, 8)).toBeCloseTo(0.08);
    expect(trackingAt(t, 40)).toBeCloseTo(-0.8);
    expect(trackingAt(null, 13)).toBe(0);
  });
});
