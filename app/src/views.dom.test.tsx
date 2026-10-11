// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Header, Preview, useSheet } from './views.tsx';

// The app's events: each listener by name, so a test can send the menu's.
const heard = vi.hoisted(() => new Map<string, () => void>());
vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, f: () => void) => {
    heard.set(name, f);
    return Promise.resolve(() => heard.delete(name));
  },
}));

// Whether the engine has drawn, set by each test: the real hook asks the engine.
const drawn = vi.hoisted(() => ({ now: false, set: (_: boolean) => {} }));
vi.mock('./preview.ts', async () => {
  const { useState } = await import('react');
  return {
    usePreview: () => {
      const [on, set] = useState(drawn.now);
      drawn.set = set;
      return on;
    },
  };
});

afterEach(() => {
  cleanup();
  drawn.now = false;
});

describe('Preview, as a screen reader finds it', () => {
  it('is a picture whose name says it is loading until it has drawn', () => {
    render(<Preview className="home-preview" />);
    expect(screen.getByRole('img', { name: 'preview of the playing preset: Loading the display…' })).toBeTruthy();
    act(() => drawn.set(true));
    // Marked as a hole, so home.css paints its corners once it draws.
    expect(screen.getByRole('img', { name: 'preview of the playing preset' }).hasAttribute('data-hole')).toBe(true);
    expect(screen.queryByText('Loading the display…')).toBeNull();
  });
});

describe('Header', () => {
  it('shows the mark unless asked not to', () => {
    const { container, rerender } = render(<Header view="home" onChange={() => {}} />);
    expect(container.querySelector('.vf-mark')).not.toBeNull();
    rerender(<Header view="home" onChange={() => {}} mark={false} />);
    expect(container.querySelector('.vf-mark')).toBeNull();
  });
});

describe('the sheets, from the app menu', () => {
  function Sheet() {
    const { sheet } = useSheet();
    return <p>{sheet ?? 'none'}</p>;
  }

  it('open Settings when the menu sends Settings… (⌘,), and stop listening once gone', async () => {
    const { unmount } = render(<Sheet />);
    expect(screen.getByText('none')).toBeTruthy();
    await act(async () => {});
    act(() => heard.get('menu-settings')?.());
    expect(screen.getByText('settings')).toBeTruthy();
    unmount();
    expect(heard.has('menu-settings')).toBe(false);
  });
});
