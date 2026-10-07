import { useEffect, useState, type ReactNode } from 'react';
import { Segmented } from '@openflow/widgets/controls/Segmented.tsx';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { HintFooter } from '@openflow/widgets/chrome/HintFooter.tsx';
import * as api from './api.ts';
import { frameReadout, type Notice } from './shell.ts';

export type View = 'editor' | 'compare' | 'live';

/**
 * The views the app offers. Compare (Butterchurn beside the engine, for judging
 * how close a preset is) is a development tool: it exists only in the dev build
 * — `import.meta.env.DEV` is false in `vite build`, so a release neither shows it
 * nor bundles Butterchurn.
 */
export const VIEWS: View[] = import.meta.env.DEV ? ['editor', 'compare', 'live'] : ['editor', 'live'];

const VIEW_HINTS: Record<View, string> = {
  editor: 'editor: browse presets and change them while they play',
  compare: 'compare: Butterchurn beside the engine, to judge how close a preset is (dev builds only)',
  live: 'live: the output full screen on a display, with performing controls',
};

/** The switch between them, the same in every view's header. */
export function ViewSwitch({ view, onChange }: { view: View; onChange(next: View): void }) {
  return (
    <Segmented
      items={VIEWS}
      index={VIEWS.indexOf(view)}
      onChange={(i) => VIEWS[i] !== view && onChange(VIEWS[i])}
      label="view"
      hint={VIEWS.map((v) => VIEW_HINTS[v]).join(' · ')}
    />
  );
}

/** The suite's wordmark, spelled the way mix[flow] spells its own. */
export function Mark() {
  return (
    <span className="vf-mark">
      visual<span>[flow]</span>
    </span>
  );
}

/** Every view's header: the mark, the view switch, then whatever the view puts in it. */
export function Header({ view, onChange, children }: { view: View; onChange(next: View): void; children?: ReactNode }) {
  return (
    <header className="vf-header">
      <Mark />
      <ViewSwitch view={view} onChange={onChange} />
      {children}
    </header>
  );
}

/** The preset playing, as the header names it: the folder quietly, then the name. */
export function NowPlaying({ group, name, empty = 'no preset' }: { group?: string; name?: string; empty?: string }) {
  if (!name) return <span className="vf-now quiet">{empty}</span>;
  const full = group ? `${group} / ${name}` : name;
  return (
    <span className="vf-now" title={full}>
      {group && <i>{group}</i>}
      <span>{name}</span>
    </span>
  );
}

/**
 * Something went wrong, said in a few plain words in the header. What was
 * actually thrown is the tooltip, for whoever needs it; the × puts it away.
 */
export function NoticeView({ notice, onDismiss }: { notice: Notice | null; onDismiss(): void }) {
  if (!notice) return null;
  return (
    <span className="vf-notice" role="status" title={notice.detail} data-hint={`${notice.message}: ${notice.detail}`}>
      <span className="vf-notice-text">{notice.message}</span>
      <Button tone="quiet" label="dismiss" title="dismiss" onPress={onDismiss}>
        ×
      </Button>
    </span>
  );
}

/**
 * The bench's frame rate. Its own leaf, polling once a second, so the reading
 * re-renders nothing else. A developer sees the numbers; a release says nothing
 * unless the picture has been slow for a few seconds.
 */
export function FrameRate() {
  const [history, setHistory] = useState<api.Stats[]>([]);
  useEffect(() => {
    const t = window.setInterval(() => {
      api.stats().then(
        (s) => setHistory((h) => [...h.slice(-7), s]),
        () => {},
      );
    }, 1000);
    return () => window.clearInterval(t);
  }, []);
  const shown = frameReadout(history, import.meta.env.DEV);
  if (!shown) return null;
  return (
    <span
      className="vf-stats"
      data-slow={shown.slow ? '' : undefined}
      title={shown.slow ? 'the picture is drawing fewer frames than the display shows: try a simpler preset or close other apps' : 'frames a second the bench draws, and the CPU time each takes'}
    >
      {shown.text}
    </span>
  );
}

/** The resting line of the hint strip: the keys every browsing view answers. */
export const RESTING_HINT = '← → previous / next preset · R random · point at anything to read what it does';

/** The strip along the bottom that says what the pointer or the focus is on. */
export function Hints({ resting = RESTING_HINT }: { resting?: string }) {
  return (
    <div className="vf-footer">
      <HintFooter resting={resting} />
    </div>
  );
}
