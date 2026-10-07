import type { ReactNode } from 'react';
import { Segmented } from '@openflow/widgets/controls/Segmented.tsx';

export type View = 'editor' | 'compare' | 'live';

/**
 * The views the app offers. Compare (Butterchurn beside the engine, for judging
 * how close a preset is) is a development tool: it exists only in the dev build
 * — `import.meta.env.DEV` is false in `vite build`, so a release neither shows it
 * nor bundles Butterchurn.
 */
export const VIEWS: View[] = import.meta.env.DEV ? ['editor', 'compare', 'live'] : ['editor', 'live'];

/** The switch between them, the same in every view's header. */
export function ViewSwitch({ view, onChange }: { view: View; onChange(next: View): void }) {
  return (
    <Segmented
      items={VIEWS}
      index={VIEWS.indexOf(view)}
      onChange={(i) => VIEWS[i] !== view && onChange(VIEWS[i])}
      label={VIEWS.join(', ')}
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
