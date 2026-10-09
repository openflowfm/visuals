// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Preview } from './views.tsx';

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
    expect(screen.getByRole('img', { name: 'preview of the playing preset' })).toBeTruthy();
    expect(screen.queryByText('Loading the display…')).toBeNull();
  });
});
