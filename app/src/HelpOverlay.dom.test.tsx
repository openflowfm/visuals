// @vitest-environment happy-dom
//
// The pattern for a test that mounts a real component in a DOM: the comment on
// the first line opts this file into happy-dom (the default is node), Testing
// Library renders and finds by role and name, as a screen reader would, and
// user-event types and clicks. Vitest's globals are off, so `cleanup` is called
// here rather than by Testing Library itself.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { HelpOverlay } from './HelpOverlay.tsx';

afterEach(cleanup);

/** The overlay as live mode opens it: from its ? button. */
function Opener() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Help</button>
      <HelpOverlay open={open} onClose={() => setOpen(false)} />
    </>
  );
}

describe('HelpOverlay in a DOM', () => {
  it('takes focus when it opens, closes on Esc, and gives focus back to its button', async () => {
    const user = userEvent.setup();
    render(<Opener />);
    const help = screen.getByRole('button', { name: 'Help' });
    await user.click(help);

    const dialog = screen.getByRole('dialog', { name: 'Live controls' });
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(help);
  });

  it('closes from its ✕ button', async () => {
    const user = userEvent.setup();
    render(<Opener />);
    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.click(screen.getByRole('button', { name: 'Close live controls' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
