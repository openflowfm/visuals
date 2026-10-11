// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

afterEach(cleanup);

describe('MoreFx', () => {
  it('leads with Speed, Colour and Trails, each a slider with its reading', () => {
    const html = renderToStaticMarkup(<MoreFx state={{ ...REST, speed: 2, hue: 0.5, trails: 0.25 }} set={none} send={none} />);
    const at = (name: string) => html.indexOf(`<span>${name}</span>`);
    expect(at('Speed')).toBeGreaterThanOrEqual(0);
    expect(at('Speed')).toBeLessThan(at('Colour'));
    expect(at('Colour')).toBeLessThan(at('Trails'));
    expect(at('Trails')).toBeLessThan(at('Mirror'));
    for (const name of ['speed', 'hue', 'trails']) expect(html).toMatch(new RegExp(`role="slider"[^>]*aria-label="${name}"`));
    expect(html).toContain('aria-valuetext="180°"');
    expect(html).toContain('aria-valuetext="0.25"');
    expect(html).toContain('(double-click resets)');
  });

  // The sliders hand their value on at the next frame, so each check waits for it.
  it('sends speed as a multiplier on the log taper, and double-click puts it back to 1×', async () => {
    const set = vi.fn();
    render(<MoreFx state={{ ...REST, speed: 2 }} set={set} send={none} />);
    const speed = screen.getByRole('slider', { name: 'speed' });
    fireEvent.keyDown(speed, { key: 'End' });
    await vi.waitFor(() => expect(set).toHaveBeenLastCalledWith({ kind: 'speed', speed: 4 }, { speed: 4 }));
    fireEvent.keyDown(speed, { key: 'Home' });
    await vi.waitFor(() => expect(set).toHaveBeenLastCalledWith({ kind: 'speed', speed: 0.25 }, { speed: 0.25 }));
    fireEvent.doubleClick(speed);
    await vi.waitFor(() => expect(set).toHaveBeenLastCalledWith({ kind: 'speed', speed: 1 }, { speed: 1 }));
  });

  it('sends the colour turn and the trails as their live actions', async () => {
    const set = vi.fn();
    render(<MoreFx state={REST} set={set} send={none} />);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'hue' }), { key: 'End' });
    await vi.waitFor(() => expect(set).toHaveBeenLastCalledWith({ kind: 'hue', value: 1 }, { hue: 1 }));
    fireEvent.keyDown(screen.getByRole('slider', { name: 'trails' }), { key: 'End' });
    await vi.waitFor(() => expect(set).toHaveBeenLastCalledWith({ kind: 'trails', value: 1 }, { trails: 1 }));
  });

  it('holds Mirror, Invert, Punch and Reset', () => {
    const html = renderToStaticMarkup(<MoreFx state={REST} set={none} send={none} />);
    for (const name of ['Mirror', 'Invert', 'Punch', 'Reset: back to normal']) expect(html).toContain(name);
    for (const mode of ['off', 'X', 'Y', '4-way']) expect(html).toContain(`>${mode}<`);
  });

  it('draws Punch as a pad that holds, with its key, and Reset as a quiet word', () => {
    const html = renderToStaticMarkup(<MoreFx state={REST} set={none} send={none} />);
    expect(html).toMatch(/<button[^>]*data-kind="punch"[^>]*class="[^"]*fx-hit[^"]*"/);
    expect(html).toContain('aria-label="Punch (P)"');
    expect(html).toContain('title="Punch: hold P, or press and hold here; Shift latches it"');
    expect(html).toMatch(/<small aria-hidden="true">P<\/small>/);
    expect(html).toMatch(/<button[^>]*data-tone="quiet"[^>]*>Reset: back to normal<\/button>/);
  });

  it('shows the hit lit while it is held', () => {
    const pad = (html: string) => /<button[^>]*data-kind="punch"[^>]*>/.exec(html)?.[0] ?? '';
    const rest = pad(renderToStaticMarkup(<MoreFx state={REST} set={none} send={none} />));
    expect(rest).toContain('aria-pressed="false"');
    expect(rest).not.toContain('data-on');
    const held = pad(renderToStaticMarkup(<MoreFx state={{ ...REST, punch: true }} set={none} send={none} />));
    expect(held).toContain('aria-pressed="true"');
    expect(held).toContain('data-on=""');
  });

  it('names its controls for VoiceOver', () => {
    const html = renderToStaticMarkup(<MoreFx state={REST} set={none} send={none} />);
    expect(html).toMatch(/role="radiogroup"[^>]*aria-label="mirror"/);
    for (const [label, shows] of [
      ['mirror off', 'off'],
      ['X: mirror across', 'X'],
      ['Y: mirror down', 'Y'],
      ['4-way: mirror four ways', '4-way'],
    ])
      expect(html).toMatch(new RegExp(`role="radio"[^>]*aria-label="${label}"[^>]*>${shows}<`));
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
    expect(html).toMatch(/role="radio"[^>]*aria-label="a quarter flash per beat"[^>]*>¼</);
    expect(html).toMatch(/role="radio"[^>]*aria-label="4 flashes per beat"[^>]*>4</);
    expect(html).toMatch(/aria-label="[^"]+ up a step"[^]*aria-label="[^"]+ up a step"/);
  });

  it("draws each setting as one of ⚙ Settings' rows, its name first", () => {
    const html = renderToStaticMarkup(<EffectSettings state={REST} set={none} />);
    expect(html.match(/<div class="settings-row"><span class="settings-row-name">/g)).toHaveLength(5);
    expect(html).toMatch(/<span class="settings-row-name">Brightness<\/span><span class="settings-row-control">[^]*?aria-label="Brightness down a step"/);
    expect(html).not.toContain('fx-setting');
  });
});
