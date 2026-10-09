// @vitest-environment happy-dom
//
// Home's playlist settings bar, read as a screen reader would.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsBar } from './Home.tsx';
import { DEFAULT_SETTINGS } from './playlists.ts';
import { say } from './words.ts';

afterEach(cleanup);

describe('the auto-advance unit', () => {
  it('names each choice in words, “s” as seconds', () => {
    render(<SettingsBar settings={DEFAULT_SETTINGS} differs={[]} onChange={() => {}} />);
    const unit = screen.getByRole('radiogroup', { name: 'seconds, bars or off' });
    const names = within(unit)
      .getAllByRole('radio')
      .map((r) => r.getAttribute('aria-label') ?? r.textContent);
    expect(names).toEqual(['seconds', 'bars', say('auto-advance off')]);
  });
});
