import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MoreFx } from './MoreEffects.tsx';
import { EffectSettings } from './Effects.tsx';
import type * as fx from './fx.ts';

/** The effects as the app reports them at rest. */
const REST: fx.Fx = {
  speed: 1,
  freeze: false,
  transition: 2,
  strobe: false,
  strobe_rate: 1,
  strobe_intensity: 1,
  strobe_style: 'white',
  sync: 'tempo',
  blackout: false,
  blackout_fade: 0.5,
  punch: false,
  punch_on_beat: false,
  brightness: 1,
  hue: 0,
  invert: false,
  mirror: 'off',
  trails: 0,
  sensitivity: 1,
  bpm: 120,
  linked: false,
  hold: false,
  bars: 4,
};

const none = () => {};

describe('MoreFx', () => {
  it('holds Mirror, Invert, Punch and Reset', () => {
    const html = renderToStaticMarkup(<MoreFx state={REST} set={none} send={none} />);
    for (const name of ['Mirror', 'Invert', 'PUNCH', 'Reset: back to normal']) expect(html).toContain(name);
    for (const mode of ['off', 'X', 'Y', '4-way']) expect(html).toContain(`>${mode}<`);
  });

  it('names its controls for VoiceOver', () => {
    const html = renderToStaticMarkup(<MoreFx state={REST} set={none} send={none} />);
    expect(html).toMatch(/role="radiogroup"[^>]*aria-label="mirror"/);
    expect(html).toMatch(/<button[^>]*aria-label="invert"/);
    expect(html).toMatch(/<button[^>]*>Reset: back to normal<\/button>/);
  });

  it('shows invert as it is', () => {
    expect(renderToStaticMarkup(<MoreFx state={REST} set={none} send={none} />)).toContain('>off<');
    const inverted = renderToStaticMarkup(<MoreFx state={{ ...REST, invert: true }} set={none} send={none} />);
    expect(inverted).toContain('>on<');
  });
});

describe('EffectSettings', () => {
  it('names every setting in plain words, with fine steps for brightness and sensitivity', () => {
    const html = renderToStaticMarkup(<EffectSettings state={{ ...REST, brightness: 1.02, blackout_fade: 1.5 }} set={none} />);
    for (const name of ['Flashes per beat', 'Strobe colour', 'Fade to black', 'Brightness']) expect(html).toContain(name);
    expect(html).toContain('1.02');
    expect(html).toContain('1.5 s');
    expect(html).toContain('aria-label="Brightness down a step"');
    expect(html).toContain('aria-label="Brightness up a step"');
    expect(html).toMatch(/aria-label="[^"]+ up a step"[^]*aria-label="[^"]+ up a step"/);
  });
});
