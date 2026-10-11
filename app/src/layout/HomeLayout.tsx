import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { say } from '../words.ts';
import type { InspectorMode, SidebarMode } from './home-model.ts';
import './layout.css';
import './inspector.css';

/**
 * Home as an inspector view (Finder's, Photos'), in the app's own look: the
 * inset sidebar down the left, the main column beside it (the header row, the
 * Now Playing hero pinned under it, the grid or a pane scrolling beneath, the
 * bar along the bottom) and the inspector down the right. The shell owns the
 * landmarks, the sizes (layout.css's `--lay-*`), how each side panel shows
 * (docked, laid over the main column, or put away) and who paints what; each
 * slot's content is its own component: `InsetSidebar`, `Hero`, the grid,
 * `TransportBar`, `Inspector`.
 *
 * The hero's picture is the native preview's hole (`Preview`, placed under the
 * page each frame), and a scroll container can't clip that view, so the hero
 * never scrolls: only the grid or pane under it does. Nothing paints under the
 * hole: the root paints nothing, each docked side panel's cell paints the
 * window's surface around its panel, and the main column is painted by the
 * picture's own spread shadow (hero.css), the header, grid and bar sitting
 * above it with no background of their own (layout.css).
 */
export interface HomeLayoutProps {
  /** The sidebar's content (`InsetSidebar`), inside the inset panel, a `nav`. */
  sidebar: ReactNode;
  /** What the sidebar is called to a screen reader; "sources", as today's. */
  sidebarLabel?: string;
  /** The header row at the top of the main column (`Header`). */
  header: ReactNode;
  /** The Now Playing card pinned at the top of the main column (`Hero`), in a region named "now playing"; it never scrolls. */
  hero?: ReactNode;
  /** What scrolls under the hero (the grid, or a story's tiles), unless `pane` is given. */
  children?: ReactNode;
  /** The bar along the bottom of the main column: the transport. */
  bar?: ReactNode;
  /** Draw a stand-in for the native window buttons and round the window's corners (stories: the real ones are macOS's). */
  lights?: boolean;
  /** The inspector (`Inspector`), in an inset panel down the right mirroring the sidebar, a named `aside`. None: closed, whatever `inspectorMode` says. */
  inspector?: ReactNode;
  /** What the inspector is called to a screen reader. */
  inspectorLabel?: string;
  /** How the sidebar shows (home-model.ts's `modesFor`): beside the main column, put away, or laid over it. */
  sidebarMode?: SidebarMode;
  /** How the inspector shows when given: beside the main column, or laid over it; null: closed. Docked by default. */
  inspectorMode?: InspectorMode;
  /** Put away what is laid over the main column (the overlay sidebar or inspector): Escape, or a press outside it. A press on a control naming the panel in `aria-controls` (`SIDEBAR_ID`, `INSPECTOR_ID`: its toggle) counts as inside. */
  onDismiss?(): void;
  /** A pane under the hero in place of `children` (Home's grid, a playlist's): it fills the rest of the column and scrolls itself, with its own side padding (the column adds none and doesn't scroll). */
  pane?: ReactNode;
}

/** What the inspector is called by default. */
export const INSPECTOR_LABEL = 'about the preset';

/** The side panels' ids: a toggle names its panel in `aria-controls`, and a press on it doesn't dismiss the panel laid over the column. */
export const SIDEBAR_ID = 'lay-sidebar';
export const INSPECTOR_ID = 'lay-inspector';

/** The inspector's inset panel (inspector.css): HomeLayout's right slot, and the inspector's frame on its own in a story. */
export function InspectorPanel({ label = INSPECTOR_LABEL, id, children, panelRef }: { label?: string; id?: string; children: ReactNode; panelRef?: RefObject<HTMLElement | null> }) {
  return (
    <aside className="lay-insp" id={id} aria-label={label} ref={panelRef} tabIndex={-1}>
      <div className="lay-insp-body">{children}</div>
    </aside>
  );
}

/** What can take focus inside a panel, in order. */
const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * A side panel laid over the main column: when it appears (not when a docked
 * one turns into it, the window narrowing), focus moves into it, and when it
 * goes, back to where it was, if it was in the panel then.
 */
function useOverlayFocus(panel: RefObject<HTMLElement | null>, mode: 'docked' | 'overlay' | null) {
  const was = useRef(mode);
  const opener = useRef<Element | null>(null);
  const overlay = mode === 'overlay';
  useEffect(() => {
    const el = panel.current;
    if (overlay && was.current === null && el) {
      opener.current = document.activeElement;
      const first = el.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? el).focus();
    }
    was.current = mode;
  }, [mode, overlay, panel]);
  // When the panel goes, focus lost with it goes back to its opener; a panel that docks instead (the window widening) keeps it.
  useEffect(() => {
    if (!overlay) return;
    return () => {
      const back = opener.current;
      opener.current = null;
      const active = document.activeElement;
      const lost = !active || active === document.body || !active.isConnected;
      if (lost && back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, [overlay, panel]);
}

/** Escape, or a press outside every panel laid over the column (and their toggles), calls `dismiss`. */
function useDismiss(side: RefObject<HTMLElement | null>, insp: RefObject<HTMLElement | null>, ids: string[], dismiss: (() => void) | undefined) {
  const latest = useRef(dismiss);
  latest.current = dismiss;
  const on = ids.length > 0 && !!dismiss;
  const key = ids.join(' ');
  useEffect(() => {
    if (!on) return;
    const open = key.split(' ');
    const inside = (target: EventTarget | null) => {
      if (!(target instanceof Node)) return true;
      if (side.current?.contains(target) || insp.current?.contains(target)) return true;
      const el = target instanceof Element ? target : target.parentElement;
      const toggle = el?.closest('[aria-controls]');
      const names = toggle?.getAttribute('aria-controls')?.split(/\s+/) ?? [];
      return names.some((n) => open.includes(n));
    };
    const press = (e: PointerEvent) => {
      if (!inside(e.target)) latest.current?.();
    };
    const keyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) latest.current?.();
    };
    document.addEventListener('pointerdown', press);
    window.addEventListener('keydown', keyDown);
    return () => {
      document.removeEventListener('pointerdown', press);
      window.removeEventListener('keydown', keyDown);
    };
  }, [on, key, side, insp]);
}

/**
 * The main column's height, kept in its `--lay-col-h` (px) for the hero's cap
 * (hero.css: the picture alone is never taller than half the column). Measured
 * rather than a size container: containment would make the column the
 * containing block of what is fixed inside it (the dragged preset's ghost).
 */
function useColumnHeight(col: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = col.current;
    if (!el) return;
    // Nothing laid out yet (0): hero.css's fallback, half the window, stands until it is.
    const set = (h: number) => h > 0 && el.style.setProperty('--lay-col-h', `${Math.round(h)}px`);
    set(el.getBoundingClientRect().height);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => set(entries[0]?.contentRect.height ?? el.getBoundingClientRect().height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [col]);
}

/** The window: the sidebar, the main column and the inspector, each shown as its mode says. */
export function HomeLayout({
  sidebar,
  sidebarLabel = 'sources',
  header,
  hero,
  children,
  bar,
  lights = false,
  inspector,
  inspectorLabel,
  sidebarMode = 'docked',
  inspectorMode = 'docked',
  onDismiss,
  pane,
}: HomeLayoutProps) {
  const side = useRef<HTMLElement | null>(null);
  const insp = useRef<HTMLElement | null>(null);
  const col = useRef<HTMLDivElement | null>(null);
  useColumnHeight(col);
  const inspMode = inspector ? inspectorMode : null;
  const sideOver = sidebarMode === 'overlay';
  const inspOver = inspMode === 'overlay';
  useOverlayFocus(side, sidebarMode === 'hidden' ? null : sidebarMode);
  useOverlayFocus(insp, inspMode);
  useDismiss(side, insp, [...(sideOver ? [SIDEBAR_ID] : []), ...(inspOver ? [INSPECTOR_ID] : [])], onDismiss);
  return (
    <div className="app home lay" data-view="home" data-sidebar={sidebarMode} data-inspector={inspMode ?? undefined} data-hero={hero ? '' : undefined} data-lights={lights ? '' : undefined}>
      {sidebarMode !== 'hidden' && (
        <div className="lay-cell lay-side-cell" data-mode={sidebarMode}>
          <nav className="lay-side" id={SIDEBAR_ID} aria-label={sidebarLabel} ref={side} tabIndex={-1}>
            <div className="lay-side-band" data-tauri-drag-region />
            <div className="lay-side-body">{sidebar}</div>
          </nav>
        </div>
      )}
      <div className="lay-col" ref={col}>
        <div className="lay-head" data-tauri-drag-region>
          {header}
        </div>
        {hero && (
          <section className="lay-hero" aria-label={say('stage')}>
            {hero}
          </section>
        )}
        <main className="lay-main" data-pane={pane ? '' : undefined}>
          {pane ?? children}
        </main>
        {bar && <div className="lay-bar">{bar}</div>}
      </div>
      {inspMode && (
        <div className="lay-cell lay-insp-cell" data-mode={inspMode}>
          <InspectorPanel label={inspectorLabel} id={INSPECTOR_ID} panelRef={insp}>
            {inspector}
          </InspectorPanel>
        </div>
      )}
      {lights && (
        <span className="lay-lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
    </div>
  );
}
