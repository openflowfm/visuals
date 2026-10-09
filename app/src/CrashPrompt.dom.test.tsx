// @vitest-environment happy-dom
//
// The crash prompt mounted as the app shows it on launch, with the commands it
// calls replaced: which reports it offers, and what it keeps as seen.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './api.ts';
import { CrashPrompt, readSeen, SEEN_KEY, type Report } from './CrashPrompt.tsx';

vi.mock('./api.ts', () => ({
  crashReportsEnabled: vi.fn(),
  crashReports: vi.fn(),
  crashReportOpen: vi.fn(),
}));

const report = (id: string, when: number): Report => ({ id, when, summary: `summary ${id}`, sent: false, text: `text of ${id}` });

function reportsAre(on: boolean, reports: Report[]) {
  vi.mocked(api.crashReportsEnabled).mockResolvedValue(on);
  vi.mocked(api.crashReports).mockResolvedValue(reports);
  vi.mocked(api.crashReportOpen).mockResolvedValue(undefined);
}

/** Lets the launch's two commands answer and the page draw what they said. */
async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CrashPrompt in a DOM', () => {
  it('offers an older report not yet seen, though a newer one was', async () => {
    const user = userEvent.setup();
    localStorage.setItem(SEEN_KEY, JSON.stringify({ when: 0, ids: ['new'] }));
    reportsAre(true, [report('new', 40), report('old', 10)]);
    render(<CrashPrompt />);

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText('text of old')).toBeTruthy();
    expect(screen.queryByText('text of new')).toBeNull();

    await user.click(screen.getByRole('button', { name: "Don't send" }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(readSeen()).toEqual({ when: 0, ids: ['new', 'old'] });
  });

  it('sends the report offered, then keeps it as seen', async () => {
    const user = userEvent.setup();
    reportsAre(true, [report('a', 10)]);
    render(<CrashPrompt />);
    await user.click(await screen.findByRole('button', { name: 'Send report' }));
    expect(api.crashReportOpen).toHaveBeenCalledWith('a');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(readSeen().ids).toEqual(['a']);
  });

  it('keeps a report seen before ids were kept as seen', async () => {
    // The old high-water mark, as an earlier version wrote it.
    localStorage.setItem(SEEN_KEY, JSON.stringify({ when: 30, ids: ['b'] }));
    reportsAre(true, [report('b', 30), report('a', 10)]);
    render(<CrashPrompt />);
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers nothing while reports are off, and keeps them all as seen', async () => {
    reportsAre(false, [report('b', 30), report('a', 10)]);
    render(<CrashPrompt />);
    await vi.waitFor(() => expect(readSeen().ids.sort()).toEqual(['a', 'b']));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
