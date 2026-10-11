// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as output from '../output.ts';
import { useLiveKeys } from '../liveKeys.ts';
import { install, type World } from '../stories/backend.ts';
import { DISPLAYS, FX, LINK_OFF, OUTPUT_OFF, OUTPUT_ON } from '../stories/fixtures.ts';
import { SHEET_EVENT } from '../views.tsx';
import type { LiveState } from './live-model.ts';
import { STAGE_CRATE_ID, type StageHeadProps } from './stage-model.ts';
import { FullScreenOffer, StageHead } from './StageHead.tsx';

let uninstall: () => void = () => {};
const app = (over: Partial<World> = {}) => {
  uninstall();
  uninstall = install(over);
};
beforeEach(() => app());
afterEach(async () => {
  cleanup();
  // The listeners come off once their subscriptions settle, which needs the app still there.
  await new Promise((done) => setTimeout(done, 0));
  uninstall();
  uninstall = () => {};
});

/** Live's state as the header reads it: the output and the effects, with the actions as spies. */
function liveOf(over: Partial<LiveState> = {}): LiveState {
  const status: output.Status = over.status ?? OUTPUT_ON;
  const displays = over.displays === undefined ? DISPLAYS : over.displays;
  return {
    lists: null,
    setLists: vi.fn(),
    deck: null,
    current: null,
    held: false,
    effects: FX,
    status,
    displays,
    inWindow: status.display === null && displays !== null,
    data: null,
    key: null,
    star: false,
    rating: null,
    says: { kind: 'held' },
    up: null,
    error: null,
    setError: vi.fn(),
    fail: () => () => {},
    dismiss: vi.fn(),
    act: vi.fn(),
    actFx: vi.fn(),
    show: vi.fn(),
    intensity: 0.5,
    setIntensity: vi.fn(),
    favourite: vi.fn(),
    rate: vi.fn(),
    ...over,
  };
}

function head(over: Partial<StageHeadProps> = {}) {
  const props: StageHeadProps = { live: liveOf(), crateOpen: true, onCrate: vi.fn(), help: false, onHelp: vi.fn(), onView: vi.fn(), ...over };
  return { props, ...render(<StageHead {...props} />) };
}

describe('the Stage header, in a DOM', () => {
  it('is the title bar: its empty space drags the window, and the spacer lets presses through to it', () => {
    const { container } = head();
    const bar = container.querySelector('header.stage-bar')!;
    expect(bar.hasAttribute('data-tauri-drag-region')).toBe(true);
    expect(bar.querySelector(':scope > .stage-fill')).not.toBeNull();
    expect(bar.querySelectorAll(':scope > .stage-cap')).toHaveLength(2);
  });

  it('toggles the crate, naming it and saying whether it shows', async () => {
    const user = userEvent.setup();
    const { props, rerender } = head({ crateOpen: true });
    const toggle = screen.getByRole('button', { name: 'playlists and up next' });
    expect(toggle.getAttribute('aria-controls')).toBe(STAGE_CRATE_ID);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.title).toBe('Hide the playlists and up next');
    await user.click(toggle);
    expect(props.onCrate).toHaveBeenCalledOnce();
    rerender(<StageHead {...props} crateOpen={false} />);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.title).toBe('Show the playlists and up next');
  });

  it('switches Home | Live as Home’s header does, with Live checked', async () => {
    const user = userEvent.setup();
    const { props } = head();
    const views = screen.getByRole('radiogroup', { name: 'view' });
    expect(within(views).getByRole('radio', { name: /live/i }).getAttribute('aria-checked')).toBe('true');
    await user.click(within(views).getByRole('radio', { name: /home/i }));
    expect(props.onView).toHaveBeenCalledWith('home');
  });

  it('shows the Link session’s tempo and peers on the Beat light, and its popover taps the tempo and holds Link', async () => {
    const user = userEvent.setup();
    const { props } = head();
    const beat = await screen.findByRole('button', { name: 'Beat, 124 BPM, 2 in time' });
    expect(beat.getAttribute('aria-expanded')).toBe('false');
    await user.click(beat);
    const pop = screen.getByRole('dialog', { name: 'Beat, 124 BPM, 2 in time' });
    await user.click(within(pop).getByRole('button', { name: /^Link tempo, 124 BPM/ }));
    expect(props.live.actFx).toHaveBeenCalledWith({ kind: 'tap' });
    expect(await within(pop).findByRole('region', { name: 'Ableton Link' })).toBeTruthy();
    expect(within(pop).getByText(/124\.0/)).toBeTruthy();
  });

  it('shows the tapped tempo without peers when Link is off', async () => {
    app({ link: LINK_OFF });
    head({ live: liveOf({ effects: { ...FX, linked: false, bpm: 98 } }) });
    expect(await screen.findByRole('button', { name: 'Beat, 98 BPM' })).toBeTruthy();
  });

  it('says where the picture goes on the Output light; its popover picks the display and says how the picture fits', async () => {
    const user = userEvent.setup();
    head();
    const out = screen.getByRole('button', { name: 'Output, on Projector (HDMI)' });
    expect(out.textContent).toContain('Projector (HDMI)');
    await user.click(out);
    const pop = screen.getByRole('dialog', { name: 'Output, on Projector (HDMI)' });
    expect(within(pop).getByText('Showing on Projector (HDMI)')).toBeTruthy();
    expect(await within(pop).findByRole('combobox', { name: 'Display' })).toBeTruthy();
    expect(within(pop).getByText(/Fills Projector \(HDMI\)\./)).toBeTruthy();
  });

  it('says "In this window" in amber while the output is closed, and its popover shows it', async () => {
    const user = userEvent.setup();
    const live = liveOf({ status: OUTPUT_OFF });
    head({ live });
    const out = screen.getByRole('button', { name: 'Output, in this window' });
    expect(out.querySelector('[data-warn]')?.textContent).toBe('In this window');
    await user.click(out);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Show' }));
    // The display that isn't the one with the menu bar, once the displays are read.
    await waitFor(() => expect(live.show).toHaveBeenCalled());
  });

  it('warns when the only display is the one with the menu bar', async () => {
    const user = userEvent.setup();
    app({ displays: [DISPLAYS[0]], output: { display: DISPLAYS[0], size: [3024, 1964] } });
    head({ live: liveOf({ status: { display: DISPLAYS[0], size: [3024, 1964] }, displays: [DISPLAYS[0]] }) });
    await user.click(screen.getByRole('button', { name: /^Output, on Built-in/ }));
    expect((await screen.findByRole('note')).textContent).toMatch(/^Only one display is connected/);
  });

  it('opens the help and settings', async () => {
    const user = userEvent.setup();
    const sheets: unknown[] = [];
    const listen = (e: Event) => sheets.push((e as CustomEvent).detail);
    window.addEventListener(SHEET_EVENT, listen);
    try {
      const { props, rerender } = head();
      const help = screen.getByRole('button', { name: 'Help' });
      expect(help.getAttribute('aria-keyshortcuts')).toBe('?');
      await user.click(help);
      expect(props.onHelp).toHaveBeenCalledOnce();
      rerender(<StageHead {...props} help />);
      expect(help.getAttribute('aria-expanded')).toBe('true');
      await user.click(screen.getByRole('button', { name: 'Settings' }));
      expect(sheets).toEqual(['settings']);
    } finally {
      window.removeEventListener(SHEET_EVENT, listen);
    }
  });

  it('has the skipped note’s live region, empty until a preset is skipped', () => {
    head();
    expect(screen.getByRole('status').textContent).toBe('');
  });
});

/** The header with live's keys, as the Stage mounts them. */
function Keyed({ live, editor }: { live: LiveState; editor(): void }) {
  useLiveKeys({ editor, act: live.act, fx: live.actFx, rate: live.rate, favourite: live.favourite, help: () => {} });
  return <StageHead live={live} crateOpen onCrate={() => {}} help={false} onHelp={() => {}} onView={() => {}} />;
}

describe('the lights’ popovers and live’s keys', () => {
  it('keeps live’s keys working with a popover open, and Esc closes the popover without leaving live', async () => {
    const user = userEvent.setup();
    const live = liveOf();
    const editor = vi.fn();
    render(<Keyed live={live} editor={editor} />);
    const out = screen.getByRole('button', { name: 'Output, on Projector (HDMI)' });
    out.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(document.activeElement).toBe(out);

    await user.keyboard('{ArrowRight}');
    expect(live.act).toHaveBeenCalledWith({ kind: 'next' });
    expect(screen.getByRole('dialog')).toBeTruthy();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(editor).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(out);

    // With the popover put away, Esc leaves live.
    await user.keyboard('{Escape}');
    expect(editor).toHaveBeenCalledOnce();
  });

  it('reaches a popover’s controls from the keyboard', async () => {
    const user = userEvent.setup();
    render(<Keyed live={liveOf()} editor={() => {}} />);
    const beat = await screen.findByRole('button', { name: 'Beat, 124 BPM, 2 in time' });
    beat.focus();
    await user.keyboard('{Enter}');
    await user.tab();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });
});

describe('Go full screen on…', () => {
  it('shows nothing while the output is on a display, or before the displays are known', () => {
    const { container, rerender } = render(<FullScreenOffer live={liveOf()} />);
    expect(container.innerHTML).toBe('');
    rerender(<FullScreenOffer live={liveOf({ status: OUTPUT_OFF, displays: null })} />);
    expect(container.innerHTML).toBe('');
  });

  it('offers each display, and opens the output on the one pressed', async () => {
    const user = userEvent.setup();
    const live = liveOf({ status: OUTPUT_OFF });
    render(<FullScreenOffer live={live} />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Go full screen on Projector (HDMI)' }));
    expect(live.show).toHaveBeenCalledWith(2);
    expect(screen.queryByText(/One display/)).toBeNull();
  });

  it('says the picture will cover this window when there is only one display', () => {
    render(<FullScreenOffer live={liveOf({ status: OUTPUT_OFF, displays: [DISPLAYS[0]] })} />);
    expect(screen.getByRole('button', { name: 'Go full screen on Built-in Retina Display' })).toBeTruthy();
    expect(screen.getByText('One display: the picture will cover this window. Esc comes back.')).toBeTruthy();
  });
});
