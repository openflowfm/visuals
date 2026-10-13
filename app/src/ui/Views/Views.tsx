import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Segmented } from '@satoramoto/zen';
import { ActionButton } from '@satoramoto/zen';
import { Hole } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import { Icon } from '../Icon/Icon';
import * as api from '../model/api';
import { usePreview } from '../model/preview';
import { say } from '../model/words';
import { frameReadout, type Notice } from '../model/shell';
import { lengthSum, useForm, type Forms, type Length } from '@satoramoto/zen';
import type { Step } from '@satoramoto/zen';
import './Views.css';

// A port of visual[flow]'s `app/src/views.tsx`: the same exports, the views every screen shares
// (the header, the preview's box, the notice banner, the frame rate, the sheets' event, the hint
// strip). Classes are `vs-*` (the original's `vf-*`); controls are the library's core ones with
// the widgets' props.

/**
 * A lab build (`VITE_LAB=1`, the `lab` feature in the app) has the editor; the
 * app people get doesn't.
 */
export const LAB = Boolean(import.meta.env.VITE_LAB);

export type View = 'home' | 'editor' | 'live';

/** The views a build offers: the home, the editor only in a lab build, and live. */
export function viewsFor(lab: boolean): View[] {
  return ['home', ...(lab ? (['editor'] as const) : []), 'live'];
}

/** The view a build starts in, and live mode goes back to: the editor in a lab build, else the home. */
export function homeFor(lab: boolean): View {
  return lab ? 'editor' : 'home';
}

/** The views the app offers. */
export const VIEWS: View[] = viewsFor(LAB);

/** The view the app starts in, and live mode goes back to. */
export const HOME: View = homeFor(LAB);

/**
 * The views every header's switch offers: `VIEWS` unless a provider says otherwise.
 * zen's built package can't read the app's `VITE_LAB`, so `VisualsApp` given a `lab`
 * editor provides `viewsFor(true)` here.
 */
export const ViewList = createContext<View[]>(VIEWS);

const VIEW_HINTS: Record<View, string> = {
  home: 'home: the library and your playlists, with the preset playing',
  editor: 'editor: browse presets and change them while they play',
  live: 'live: the output full screen on a display, with performing controls',
};

/** What the preview says until it has drawn. */
const LOADING = 'Loading the display…';

/**
 * **Job.** Where the preview goes: the native view the engine draws in is placed
 * under this box and shows through it. Until it has drawn, the box is a plain
 * surface saying the display is loading, so the page never shows a hole; once it
 * draws, the box paints nothing over the picture.
 *
 * **Changed.** The box is a layout `Hole` (it paints nothing and is named as a
 * picture), inside the measured element that carries `className`, `data-hole` and
 * `data-loading`. Its corners are rounded by painting them in `--layer-base-solid`
 * (the frost's opaque tone) over the square native view; a screen sets the radius
 * with `--vs-hole-radius` (home.css's `--hole-radius`). Anything a screen lays over
 * the preview goes in an `Opaque` scope, so no layer over it is translucent or blurs.
 * In stories the frame paints the starter still into the hole (story.tsx).
 *
 * **Kept.** A picture's (`role="img"`) contents are presentational, so the loading
 * text goes in its name and the text on screen is hidden from screen readers.
 *
 * **Tuning knobs** (Views.css):
 * - `--vs-hole-radius`: the preview's corner radius, 0 by default; a screen sets it.
 * - `--vs-hole-corner`: the opaque tone painted in the corners over the square native view,
 *   `--layer-base-solid` by default; a screen sets it to whatever surrounds the picture.
 */
export function Preview({ className }: { className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const drawing = usePreview(ref);
  const name = `${say('bench')} of the playing preset`;
  return (
    <div className={`vs-preview ${className}`} ref={ref} data-hole="" data-loading={drawing ? undefined : ''}>
      <Hole className="vs-preview-hole" name={drawing ? name : `${name}: ${LOADING}`}>
        {!drawing && (
          <Text className="vs-preview-loading" aria-hidden="true">
            {LOADING}
          </Text>
        )}
      </Hole>
    </div>
  );
}

/**
 * **Job.** The switch between the views, the same in every view's header.
 *
 * **Changed.** The library's core `Segmented` (the widgets' props), so the theme's
 * tabs material draws it: under the visuals pack, words with the chosen one
 * underlined in the accent, as home.css drew them.
 *
 * The words read "Home", "Live" (home.css's and stage-head.css's capitalize): the items are
 * written capitalised, each named by its view's id.
 *
 * **Kept.** Its items' names, label and hint.
 */
export function ViewSwitch({ view, onChange }: { view: View; onChange(next: View): void }) {
  const views = useContext(ViewList);
  return (
    <Segmented
      className="vs-viewswitch"
      items={views.map(capitalised)}
      itemLabels={views}
      index={views.indexOf(view)}
      onChange={(i) => views[i] !== view && onChange(views[i])}
      label="view"
      hint={views.map((v) => VIEW_HINTS[v]).join(' · ')}
    />
  );
}

/** A view's id as the switch prints it: "home" → "Home". */
const capitalised = (v: View) => v.charAt(0).toUpperCase() + v.slice(1);

/**
 * **Job.** The suite's wordmark, spelled the way mix[flow] spells its own.
 *
 * **Changed.** A display `Text` (the faces' display face, weight and tracking) at
 * `--vs-text-heading`; its bracketed half the accent (the original's `--primary`).
 *
 * **Kept.** The shape: the name, then `[flow]` in the primary tone.
 */
export function Mark() {
  return (
    <Text role="display" className="vs-mark">
      visual<span>[flow]</span>
    </Text>
  );
}

/* ---------- the header's forms (docs/assembly.md): what the home's header row needs ---------- */

/** The header's forms: `full` (the original's spacing), then `narrow` (closed up, the search folded to its ⌕). */
export type HeaderForm = 'full' | 'narrow';

const gaps = (step: Step, n: number): Length => ({ space: Array<Step>(n).fill(step) });

/**
 * The home's header row (Home.tsx), its parts added up: the lead sidebar toggle (a control); the
 * view switch's words ("Home", "Live") in label chars; the library toolbar portaled in, its search
 * field (`search`) and "Filter ▾" in caption chars, a `--space-3` between them; the camera, Help
 * and inspector toggles (a control each); the header's gaps between its seven items (the toggle,
 * the switch, the spacer, the toolbar, the three toggles), and its own padding either side. It
 * leaves out the pane's title: the home header has none (the library's title head is in its pane).
 */
const homeRow = (gap: Step, pad: [Step, Step], search: Length): Length =>
  lengthSum(
    { control: 1 }, // the sidebar toggle
    { chars: { label: 'HomeLive'.length } }, // the view switch's words
    search, // the toolbar's search field
    { space: 3 }, // the toolbar's gap
    { chars: { caption: 'Filter ▾'.length } }, // "Filter ▾"
    { control: 3 }, // the camera, Help and inspector toggles
    gaps(gap, 6), // between the header's seven items
    { space: pad }, // its padding, right and left
  );

/** The header's own height: a control and `--space-4` (Views.css's min-height). */
const HEADER_H: Length = { control: 1, space: 4 };

/**
 * The header's forms. At the visuals pack's roomy scale (control 30, unit 4, label 13, caption 12):
 * `full` is 30 + 62.4 + 180 + 12 + 57.6 + 90 + 6 × 16 + (12 + 16) = 556px; `narrow` is
 * 30 + 62.4 + 30 + 12 + 57.6 + 90 + 6 × 12 + (8 + 12) = 374px. Both 46px high.
 */
export const HEADER_FORMS: Forms<HeaderForm> = [
  // full: gaps of --space-4, padding --space-3 and --space-4, the search field at six controls
  { id: 'full', min: { w: homeRow(4, [3, 4], { control: 6 }), h: HEADER_H }, ideal: { w: homeRow(4, [3, 4], { control: 6 }), h: HEADER_H }, grow: { w: true } },
  // narrow: closed up (gaps of --space-3, padding --space-2 and --space-3), the search folded to its ⌕ (a control)
  { id: 'narrow', min: { w: homeRow(3, [2, 3], { control: 1 }), h: HEADER_H }, ideal: { w: homeRow(3, [2, 3], { control: 1 }), h: HEADER_H }, grow: { w: true } },
];

/**
 * **Job.** Every view's header: the mark, the view switch, then whatever the view
 * puts in it. In the main window it is the title bar too: its empty space drags the
 * window. `lead` goes before the mark (the home's sidebar toggle). `mark={false}`
 * leaves the mark out (the home shows it atop its sidebar).
 *
 * **Changed.** It paints no background and no rule under it in any view (the
 * original's rail was overridden away by Home's, decision 68): the screen's layers
 * decide what is behind it. Spacing reads the scale. It declares its forms
 * (`HEADER_FORMS`, `Header.forms`) and reads its form with `useForm`, so a `form` prop wins,
 * then the assembled screen's choice for its region; outside one it is `full`. The form is
 * `data-form` on the header: `narrow` closes it up (Views.css) and folds the library's search
 * to its ⌕ (Library.css), where the original did both under a 700px window.
 *
 * **Kept.** Its props, the drag region and the one row of type.
 */
export function Header({
  view,
  onChange,
  lead,
  mark = true,
  form: given,
  children,
}: {
  view: View;
  onChange(next: View): void;
  lead?: ReactNode;
  mark?: boolean;
  form?: HeaderForm;
  children?: ReactNode;
}) {
  const form = useForm(HEADER_FORMS, given);
  return (
    <Text as="header" className="vs-header" data-tauri-drag-region data-form={form}>
      {lead}
      {mark && <Mark />}
      <ViewSwitch view={view} onChange={onChange} />
      {children}
    </Text>
  );
}
Header.forms = HEADER_FORMS;

/**
 * **Job.** The preset playing, as the header names it: the folder quietly, then the name.
 *
 * **Changed.** Nothing but the classes and the contract's inks.
 *
 * **Kept.** The full path as its tooltip, and the quiet empty state.
 */
export function NowPlaying({ group, name, empty = 'no preset' }: { group?: string; name?: string; empty?: string }) {
  if (!name)
    return (
      <Text size="inherit" className="vs-now vs-quiet">
        {empty}
      </Text>
    );
  const full = group ? `${group} / ${name}` : name;
  return (
    <Text size="inherit" className="vs-now" title={full}>
      {group && (
        <Text as="i" className="vs-now-group">
          {group}
        </Text>
      )}
      <Text className="vs-now-name">{name}</Text>
    </Text>
  );
}

/**
 * **Job.** Something went wrong, said in a few plain words: in the editor's header,
 * above live mode's preview, in the Link panel. What the app actually said is the
 * tooltip (and the hint strip's text), for whoever needs it; the dismiss button puts
 * it away. `className` places it; the header's is the plain `vs-notice`.
 *
 * **Changed.** The dismiss key is the core `ActionButton` (the widgets' Button
 * props) with the icon set's `close` in place of the ✕ character, so it shares the
 * icons' stroke. The ink is `--danger`.
 *
 * **Kept.** `role="alert"`, the tooltip and hint, the outlined chip in a header.
 */
export function NoticeBanner({ notice, onDismiss, className }: { notice: Notice | null; onDismiss(): void; className?: string }) {
  if (!notice) return null;
  return (
    <div
      className={className ? `vs-notice ${className}` : 'vs-notice'}
      role="alert"
      title={notice.detail ?? undefined}
      data-hint={notice.detail ? `${notice.message}: ${notice.detail}` : notice.message}
    >
      <span className="vs-notice-text">{notice.message}</span>
      <ActionButton tone="quiet" label="Dismiss" title="Dismiss" onPress={onDismiss}>
        <Icon name="close" size={12} />
      </ActionButton>
    </div>
  );
}

/**
 * **Job.** The bench's frame rate. Its own leaf, polling once a second, so the
 * reading re-renders nothing else. A developer sees the numbers; a release says
 * nothing unless the picture has been slow for a few seconds. `always` shows the
 * numbers in every build, as live mode's header does; `slowOnly` says nothing until
 * the picture is slow, in a developer's build too (the home's bottom bar).
 *
 * **Changed.** Tabular figures in the readout face; slow is `--warning`.
 *
 * **Kept.** The polling, the readings and the words.
 */
export function FrameRate({ always = false, slowOnly = false }: { always?: boolean; slowOnly?: boolean }) {
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
      <Text tabular className="vs-stats" title="Frames drawn each second, and the time the engine spends on each">
        {now.text}
      </Text>
    );
  }
  const shown = frameReadout(history, import.meta.env.DEV && !slowOnly);
  if (!shown || (slowOnly && !shown.slow)) return null;
  return (
    <Text
      tabular
      className="vs-stats"
      data-slow={shown.slow ? '' : undefined}
      title={shown.slow ? 'the picture is drawing fewer frames than the display shows: try a simpler preset or close other apps' : 'frames a second the preview draws, and the CPU time each takes'}
    >
      {shown.text}
    </Text>
  );
}

/** The sheets that open over any view: Settings and the More effects drawer. They are drawn on `Layer level="overlay"` by whoever mounts them. */
export type Sheet = 'settings' | 'effects' | 'camera';

/** The page's event that opens a sheet; its `detail` is the `Sheet`. Kept as the original's name, so a page mixing both still hears it. */
export const SHEET_EVENT = 'vf-sheet';

/** Open a sheet over whatever view is showing, from anywhere in the page (live mode's gear, say), without reaching into `App`. */
export const openSheet = (sheet: Sheet) => window.dispatchEvent(new CustomEvent<Sheet>(SHEET_EVENT, { detail: sheet }));

/** The sheet a `SHEET_EVENT` asks for; null for anything else. */
export function sheetOf(e: Event): Sheet | null {
  const detail = (e as CustomEvent<unknown>).detail;
  return detail === 'settings' || detail === 'effects' || detail === 'camera' ? detail : null;
}

/** The sheet showing, opened by `openSheet`, for `App` to mount; `close` puts it away. While `enabled` is false (onboarding up, say), the menu's Settings… is ignored. */
export function useSheet(enabled = true): { sheet: Sheet | null; close(): void } {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const on = useRef(enabled);
  on.current = enabled;
  useEffect(() => {
    const open = (e: Event) => setSheet((s) => sheetOf(e) ?? s);
    window.addEventListener(SHEET_EVENT, open);
    // The app menu's Settings… (⌘,) opens it too; outside the app (a story, a test) nothing sends it.
    let off: (() => void) | null = null;
    let gone = false;
    try {
      api
        .onMenuSettings(() => on.current && setSheet('settings'))
        .then(
          (un) => (gone ? un() : (off = un)),
          () => {},
        );
    } catch {
      // No backend here.
    }
    return () => {
      gone = true;
      off?.();
      window.removeEventListener(SHEET_EVENT, open);
    };
  }, []);
  const close = useCallback(() => setSheet(null), []);
  return { sheet, close };
}

/** The resting line of the hint strip: the keys every browsing view answers. */
export const RESTING_HINT = '← → previous / next preset · R random · point at anything to read what it does';

/** The nearest `data-hint` wins, and only if there is none the nearest `title` (the widgets' `hintFor`). */
function hintFor(from: EventTarget | null): string | null {
  if (!from || typeof (from as Element).closest !== 'function') return null;
  const at = from as Element;
  const hinted = at.closest('[data-hint]')?.getAttribute('data-hint')?.trim();
  if (hinted) return hinted;
  const titled = at.closest('[title]')?.getAttribute('title')?.trim();
  return titled ? titled : null;
}

/** The widgets' `HintFooter`: one document listener, the hint in this leaf's own state; the pointer outranks the focus. */
function HintFooter({ resting = '' }: { resting?: string }) {
  const [pointed, setPointed] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  useEffect(() => {
    const over = (event: Event) => setPointed(hintFor(event.target));
    const out = (event: PointerEvent) => {
      if (!event.relatedTarget) setPointed(null);
    };
    const focus = (event: Event) => setFocused(hintFor(event.target));
    const blur = () => setFocused(null);
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', blur);
    return () => {
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', blur);
    };
  }, []);
  const says = pointed ?? focused ?? resting;
  return (
    <Text as="footer" className="vs-hint" {...((pointed ?? focused) ? {} : { 'data-resting': '' })}>
      <span className="vs-hint-text">{says}</span>
    </Text>
  );
}

/**
 * **Job.** The strip along the bottom that says what the pointer or the focus is on.
 *
 * **Changed.** The widgets' `HintFooter` is folded in here (the library has no hint
 * strip of its own); it draws in the faces' sans, not a monospace, with no rule above
 * it (near borderless, decision 68).
 *
 * **Kept.** The lookup (`data-hint`, then `title`), the pointer outranking the focus,
 * and the resting line. It is not a live region.
 */
export function Hints({ resting = RESTING_HINT }: { resting?: string }) {
  return (
    <div className="vs-footer">
      <HintFooter resting={resting} />
    </div>
  );
}
