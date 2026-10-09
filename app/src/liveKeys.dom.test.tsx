// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { HelpOverlay } from './HelpOverlay.tsx';
import { useLiveKeys } from './liveKeys.ts';

afterEach(cleanup);

/** Live mode's keys and its ? overlay, with a sheet that can be open over them, as `Live` and `App` mount them (the sheet's own focus left on ⚙, outside it). */
function Page({ sheet }: { sheet: boolean }) {
  const [help, setHelp] = useState(false);
  useLiveKeys({ editor: () => {}, act: () => {}, fx: () => {}, rate: () => {}, favourite: () => {}, help: () => setHelp((h) => !h) });
  return (
    <>
      <button>⚙</button>
      {sheet && (
        <div className="vf-sheet" role="dialog" aria-modal="true" aria-label="Settings">
          <button>Close</button>
        </div>
      )}
      <HelpOverlay open={help} onClose={() => setHelp(false)} />
    </>
  );
}

describe('? in live mode, in a DOM', () => {
  it('does nothing while a sheet is open, so the help never shows over it', async () => {
    const user = userEvent.setup();
    const view = render(<Page sheet />);
    screen.getByRole('button', { name: '⚙' }).focus();
    await user.keyboard('?');
    expect(screen.queryByRole('dialog', { name: 'Live controls' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();

    // Once the sheet is closed, ? opens the help, and ? again closes it.
    view.rerender(<Page sheet={false} />);
    screen.getByRole('button', { name: '⚙' }).focus();
    await user.keyboard('?');
    expect(screen.getByRole('dialog', { name: 'Live controls' })).toBeTruthy();
    await user.keyboard('?');
    expect(screen.queryByRole('dialog', { name: 'Live controls' })).toBeNull();
  });
});
