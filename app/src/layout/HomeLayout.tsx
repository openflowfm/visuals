import type { ReactNode } from 'react';
import { say } from '../words.ts';
import './layout.css';

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
}

/** The window: the inset sidebar and the main column. */
export function HomeLayout({ sidebar, sidebarLabel = 'sources', header, hero, children, bar, lights = false }: HomeLayoutProps) {
  return (
    <div className="app home lay" data-view="home">
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
    </div>
  );
}
