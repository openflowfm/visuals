// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { install, type World } from '../fixtures/backend';
import { ENTRIES } from '../fixtures/fixtures';
import { sample } from '../fixtures/presets';
import { SIDEBAR_ID } from '../HomeLayout/HomeLayout';
import { SEEDED_KEY } from '../model/home';
import { VisualsApp } from '../App/App';
import { Editor } from './Editor';

/** A page's local storage in memory (as App.test.tsx: Node's own global hides jsdom's). */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    key: (i) => [...items.keys()][i] ?? null,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, String(v)),
    removeItem: (k) => void items.delete(k),
    clear: () => items.clear(),
  };
}

beforeEach(() => {
  const storage = memoryStorage();
  storage.setItem(SEEDED_KEY, '1');
  vi.stubGlobal('localStorage', storage);
});

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
  vi.unstubAllGlobals();
});

/** Every library entry opens as the sample preset, so whichever the editor starts on has stages. */
const presets = Object.fromEntries(ENTRIES.map((e) => [e.path, sample()]));

function lab(world: Partial<World> = {}) {
  restore = install({ presets, ...world });
  return render(<VisualsApp chrome={false} lab={Editor} />);
}

describe('VisualsApp with the lab editor', () => {
  it('starts in the editor, with the preset open in the graph and the inspector', async () => {
    const { container } = lab();
    const editor = await screen.findByRole('group', { name: 'editor' });
    expect(container.querySelector(`#${SIDEBAR_ID}`)).toBeNull();
    // The stage inspector shows the first stage of the open preset (motion), with its code.
    const stage = within(editor).getByRole('region', { name: 'stage' });
    await waitFor(() => expect(within(stage).getAllByRole('textbox').length).toBeGreaterThan(0));
    expect(container.querySelector('.lib-graph')).not.toBeNull();
  });

  it('offers the editor in the view switch, and leaves it for the home', async () => {
    const { container } = lab();
    const editor = await screen.findByRole('group', { name: 'editor' });
    const views = within(editor).getByRole('radiogroup', { name: 'view' });
    expect(
      within(views)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Home', 'Editor', 'Live']);
    await userEvent.click(within(views).getByRole('radio', { name: 'home' }));
    await waitFor(() => expect(container.querySelector(`#${SIDEBAR_ID}`)).not.toBeNull());
  });

  it('is not offered without a lab', async () => {
    restore = install({ presets });
    const { container } = render(<VisualsApp chrome={false} />);
    await waitFor(() => expect(container.querySelector(`#${SIDEBAR_ID}`)).not.toBeNull());
    expect(screen.queryByRole('radio', { name: 'editor' })).toBeNull();
  });
});
