// @vitest-environment happy-dom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// What the app answers `reduced_motion` with, changed between reads as macOS's settings would be.
const answer = vi.hoisted(() => ({ now: { reduced: false, system: true, transparency: true } as { reduced: boolean; system: boolean; transparency?: boolean } }));
vi.mock('./api.ts', () => ({ reducedMotion: () => Promise.resolve({ ...answer.now }), reducedMotionSet: () => Promise.resolve({ reduced: false, system: true }) }));

import { useAccessibility } from './access.ts';

function Mounted() {
  useAccessibility();
  return null;
}

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.transparency;
});

describe("the page follows macOS's Reduce transparency", () => {
  it('marks the document on mount, and again when the window comes back to the front', async () => {
    render(<Mounted />);
    await waitFor(() => expect(document.documentElement.dataset.transparency).toBe('reduced'));
    // Turned off in System Settings; back in the app, it reads again.
    answer.now = { reduced: false, system: true, transparency: false };
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect('transparency' in document.documentElement.dataset).toBe(false));
  });
});
