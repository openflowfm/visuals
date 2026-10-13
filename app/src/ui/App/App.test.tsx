// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { install, type World } from '../fixtures/backend';
import { SIDEBAR_ID } from '../HomeLayout/HomeLayout';
import { SEEDED_KEY } from '../model/home';
import { VisualsApp } from './App';

/** A page's local storage in memory: Node's own `localStorage` global (unset without `--localstorage-file`) hides jsdom's. */
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
  // As a story's first run left it (fixtures/story.tsx `visualsBeforeEach`): the starter set seeded.
  storage.setItem(SEEDED_KEY, '1');
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => vi.unstubAllGlobals());

let restore: (() => void) | null = null;
function app(world: Partial<World> = {}) {
  restore = install(world);
  return render(<VisualsApp chrome={false} />);
}
afterEach(() => {
  restore?.();
  restore = null;
});

describe('VisualsApp', () => {
  it('opens on the home past the first run', async () => {
    const { container } = app();
    await waitFor(() => expect(container.querySelector(`#${SIDEBAR_ID}`)).not.toBeNull());
    expect(screen.queryByRole('button', { name: 'Skip setup' })).toBeNull();
  });

  it('opens on the welcome flow when it is owed', async () => {
    const { container } = app({ firstRun: true, flashUnderstood: false });
    expect(await screen.findByRole('button', { name: 'Skip setup' })).toBeInTheDocument();
    expect(container.querySelector(`#${SIDEBAR_ID}`)).toBeNull();
  });

  it('wears the visuals pack in its own window', async () => {
    const { container } = app();
    expect(container.querySelector('.lib-scope > .vs-app[data-layer="ground"] > .vs-root')).not.toBeNull();
  });

  it('says so with no backend installed', () => {
    render(<VisualsApp chrome={false} />);
    expect(screen.getByText(/without the app behind it/)).toBeInTheDocument();
  });
});
