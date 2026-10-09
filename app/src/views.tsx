import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Segmented } from '@openflow/widgets/controls/Segmented.tsx';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { HintFooter } from '@openflow/widgets/chrome/HintFooter.tsx';
import * as api from './api.ts';
import { usePreview } from './preview.ts';
import { say } from './words.ts';
import { frameReadout, type Notice } from './shell.ts';
import { HOME_READY } from './homeReady.ts';

/**
 * A lab build (`npm run app:lab`: `VITE_LAB=1` here, the `lab` feature in the
 * app) has the editor; the app people get doesn't.
 */
export const LAB = Boolean(import.meta.env.VITE_LAB);

export type View = 'home' | 'library' | 'editor' | 'live';

/** The views a build offers: the home first once it is ready, the editor only in a lab build. */
export function viewsFor(lab: boolean, homeReady: boolean): View[] {
  return [...(homeReady ? (['home'] as const) : []), 'library', ...(lab ? (['editor'] as const) : []), 'live'];
}

/** The view a build starts in, and live mode goes back to: the editor in a lab build, else the home once it is ready, else the library. */
export function homeFor(lab: boolean, homeReady: boolean): View {
  return lab ? 'editor' : homeReady ? 'home' : 'library';
}

/** The views the app offers. */
export const VIEWS: View[] = viewsFor(LAB, HOME_READY);

/** The view the app starts in, and live mode goes back to. */
export const HOME: View = homeFor(LAB, HOME_READY);

const VIEW_HINTS: Record<View, string> = {
  home: 'home: your playlists and what you played last, to pick up where you left off',
  library: 'library: browse presets and play them in the preview',
  editor: 'editor: browse presets and change them while they play',
  live: 'live: the output full screen on a display, with performing controls',
};

/** What the preview says until it has drawn. */
const LOADING = 'Loading the display…';

/**
 * Where the preview goes: the native view the engine draws in is placed under
 * this box, and shows through it. Until it has drawn, the box is a plain surface
 * saying the display is loading, so the page never shows a hole; once it draws,
 * the box paints nothing over the picture. A picture's (`role="img"`) contents
 * are presentational, so VoiceOver never reads text inside it: the loading text
 * goes in its name instead, and the text on screen is hidden from it.
 */
export function Preview({ className }: { className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const drawing = usePreview(ref);
  const name = `${say('bench')} of the playing preset`;
  return (
    <div className={className} ref={ref} role="img" aria-label={drawing ? name : `${name}: ${LOADING}`} data-loading={drawing ? undefined : ''}>
      {!drawing && (
        <span className="bench-loading" aria-hidden="true">
          {LOADING}
        </span>
      )}
    </div>
  );
}

/** The switch between them, the same in every view's header. */
export function ViewSwitch({ view, onChange }: { view: View; onChange(next: View): void }) {
  return <Segmented items={VIEWS} index={VIEWS.indexOf(view)} onChange={(i) => VIEWS[i] !== view && onChange(VIEWS[i])} label="view" hint={VIEWS.map((v) => VIEW_HINTS[v]).join(' · ')} />;
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
      title={shown.slow ? 'the picture is drawing fewer frames than the display shows: try a simpler preset or close other apps' : 'frames a second the preview draws, and the CPU time each takes'}
    >
      {shown.text}
    </span>
  );
}

/** The sheets that open over any view: ⚙ Settings (#98) and the More effects drawer (#98). */
export type Sheet = 'settings' | 'effects';

/** The page's event that opens a sheet; its `detail` is the `Sheet`. */
export const SHEET_EVENT = 'vf-sheet';

/** Open a sheet over whatever view is showing, from anywhere in the page (live mode's ⚙, say), without reaching into `App`. */
export const openSheet = (sheet: Sheet) => window.dispatchEvent(new CustomEvent<Sheet>(SHEET_EVENT, { detail: sheet }));

/** The sheet a `SHEET_EVENT` asks for; null for anything else. */
export function sheetOf(e: Event): Sheet | null {
  const detail = (e as CustomEvent<unknown>).detail;
  return detail === 'settings' || detail === 'effects' ? detail : null;
}

/** The sheet showing, opened by `openSheet`, for `App` to mount; `close` puts it away. */
export function useSheet(): { sheet: Sheet | null; close(): void } {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  useEffect(() => {
    const open = (e: Event) => setSheet((s) => sheetOf(e) ?? s);
    window.addEventListener(SHEET_EVENT, open);
    return () => window.removeEventListener(SHEET_EVENT, open);
  }, []);
  const close = useCallback(() => setSheet(null), []);
  return { sheet, close };
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
