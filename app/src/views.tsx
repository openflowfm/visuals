import { useEffect, useState, type ReactNode } from 'react';
import { Segmented } from '@openflow/widgets/controls/Segmented.tsx';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { HintFooter } from '@openflow/widgets/chrome/HintFooter.tsx';
import * as api from './api.ts';
import { frameReadout, type Notice } from './shell.ts';

export type View = 'editor' | 'live';

/** The views the app offers. */
export const VIEWS: View[] = ['editor', 'live'];

const VIEW_HINTS: Record<View, string> = {
  editor: 'editor: browse presets and change them while they play',
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
 * Something went wrong, said in a few plain words: in the editor's header, above
 * live mode's preview, in the Link panel. What the app actually said is the
 * tooltip (and the hint strip's text), for whoever needs it; the ✕ puts it away.
 * `className` places it (`live-problem`, `link-problem`); the header's is the
 * plain `vf-notice`.
 */
export function NoticeBanner({ notice, onDismiss, className }: { notice: Notice | null; onDismiss(): void; className?: string }) {
  if (!notice) return null;
  return (
    <div
      className={className ? `vf-notice ${className}` : 'vf-notice'}
      role="alert"
      title={notice.detail ?? undefined}
      data-hint={notice.detail ? `${notice.message}: ${notice.detail}` : notice.message}
    >
      <span className="vf-notice-text">{notice.message}</span>
      <Button tone="quiet" label="Dismiss" title="Dismiss" onPress={onDismiss}>
        ✕
      </Button>
    </div>
  );
}

/**
 * The bench's frame rate. Its own leaf, polling once a second, so the reading
 * re-renders nothing else. A developer sees the numbers; a release says nothing
 * unless the picture has been slow for a few seconds. `always` shows the numbers
 * in every build, as live mode's header does.
 */
export function FrameRate({ always = false }: { always?: boolean }) {
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
  if (always) {
    // Live mode reads 0 fps until the first second's reading arrives.
    const now = frameReadout(history.length ? history : [{ fps: 0, cpu_ms: 0 }], true)!;
    return (
      <span className="stats" title="Frames drawn each second, and the time the engine spends on each">
        {now.text}
      </span>
    );
  }
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
