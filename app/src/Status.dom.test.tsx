// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from './api.ts';
import { SkipNote } from './Status.tsx';

const skipped: ((path: string) => void)[] = [];
vi.mock('./api.ts', async (original) => ({
  ...(await original<typeof import('./api.ts')>()),
  onPresetSkipped: vi.fn((f: (path: string) => void) => {
    skipped.push(f);
    return Promise.resolve(() => {});
  }),
}));

afterEach(() => {
  cleanup();
  skipped.length = 0;
});

describe('the skipped note in a DOM', () => {
  it('is an empty live region until a skip, then says it, with the whole line in its tooltip for when a narrow strip cuts it short', () => {
    render(<SkipNote />);
    const note = screen.getByRole('status');
    expect(note.textContent).toBe('');
    expect(note.getAttribute('title')).toBeNull();
    expect(api.onPresetSkipped).toHaveBeenCalled();

    act(() => skipped.forEach((f) => f('pack/broken.milk')));
    act(() => skipped.forEach((f) => f('pack/worse.milk')));
    expect(note.textContent).toBe('Skipped 2 broken presets');
    expect(note.getAttribute('title')).toBe('Skipped 2 broken presets');
  });
});
