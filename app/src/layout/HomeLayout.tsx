import type { ReactNode } from 'react';
import { say } from '../words.ts';
import './layout.css';
import './inspector.css';

/**
 * Home in the macOS 26/27 app layout (a reference, in Storybook only; Home.tsx
 * stays as it is): the window, an inset sidebar down its left, and the main
 * column beside it, with the header row, the Now Playing hero and the titled
 * sections under it, scrolling, and the bar along the bottom. Only the layout
 * comes from Apple's kit; the look is the app's own (home.css's tokens and
 * type, near borderless). The shell owns the landmarks and the sizes
 * (layout.css's `--lay-*`); each slot's content is its own component:
 * `InsetSidebar`, `Hero`, `Section`.
 */
export interface HomeLayoutProps {
  /** The sidebar's content (`InsetSidebar`), inside the inset panel, a `nav`. */
  sidebar: ReactNode;
  /** What the sidebar is called to a screen reader; "sources", as today's. */
  sidebarLabel?: string;
  /** The header row at the top of the main column (today's `Header`). */
  header: ReactNode;
  /** The Now Playing card at the top of the main column (`Hero`), in a region named "now playing". */
  hero?: ReactNode;
  /** The sections under the hero (`Section`s), spaced apart, no lines. */
  children?: ReactNode;
  /** The bar along the bottom of the main column: the transport. */
  bar?: ReactNode;
  /** Draw a stand-in for the native window buttons in the sidebar's top band (stories: the real ones are macOS's). */
  lights?: boolean;
  /** The inspector's content, in an inset panel down the right mirroring the sidebar (macOS 26's inspector), a named `aside`; the main column narrows beside it. None: closed. */
  inspector?: ReactNode;
  /** What the inspector is called to a screen reader. */
  inspectorLabel?: string;
}

/** What the inspector is called by default. */
export const INSPECTOR_LABEL = 'about the preset';

/** The inspector's inset panel (inspector.css): HomeLayout's right slot, and an option's frame on its own in a story. */
export function InspectorPanel({ label = INSPECTOR_LABEL, children }: { label?: string; children: ReactNode }) {
  return (
    <aside className="lay-insp" aria-label={label}>
      <div className="lay-insp-body">{children}</div>
    </aside>
  );
}

/** The window: the inset sidebar and the main column, and the inspector when open. */
export function HomeLayout({ sidebar, sidebarLabel = 'sources', header, hero, children, bar, lights = false, inspector, inspectorLabel }: HomeLayoutProps) {
  return (
    <div className="app home lay" data-view="home" data-inspector={inspector ? '' : undefined}>
      <nav className="lay-side" aria-label={sidebarLabel}>
        {lights && (
          <span className="lay-lights" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        )}
        <div className="lay-side-body">{sidebar}</div>
      </nav>
      <div className="lay-col">
        <div className="lay-head">{header}</div>
        <main className="lay-main">
          {hero && (
            <section className="lay-hero" aria-label={say('stage')}>
              {hero}
            </section>
          )}
          <div className="lay-sections">{children}</div>
        </main>
        {bar && <div className="lay-bar">{bar}</div>}
      </div>
      {inspector && <InspectorPanel label={inspectorLabel}>{inspector}</InspectorPanel>}
    </div>
  );
}
