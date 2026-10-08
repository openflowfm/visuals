import { useMemo } from 'react';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import type { Entry } from './api.ts';
import { credits, PACK_PAGE, TAKEDOWN } from './pack.ts';
import './credits.css';

const count = (n: number) => n.toLocaleString('en-US');

/**
 * Where the presets come from, the terms they come under, and everyone the
 * library's file names credit, shown in place of the preset list.
 */
export function Credits({ entries, onBack }: { entries: Entry[]; onBack(): void }) {
  const authors = useMemo(() => credits(entries), [entries]);
  return (
    <div className="credits">
      <div className="credits-head">
        <h2>Credits</h2>
        <Button tone="quiet" onPress={onBack} title="Back to the presets">
          ← Presets
        </Button>
      </div>
      <div className="credits-body">
        <p>
          The presets come from projectM's{' '}
          <a href={PACK_PAGE} target="_blank" rel="noreferrer" title={PACK_PAGE}>
            Cream of the Crop
          </a>
          , curated by ISOSCELES from decades of MilkDrop presets.
        </p>
        <p>
          Their authors released them freely, with no license; each author keeps their rights. Any author can ask for theirs to be taken out:{' '}
          <a href={TAKEDOWN} target="_blank" rel="noreferrer" title={TAKEDOWN}>
            ask for a takedown
          </a>
          .
        </p>
        <h3>
          {authors.length ? `${count(authors.length)} authors` : 'Authors'}
          <span className="credits-sub"> in this library, by presets</span>
        </h3>
        {authors.length ? (
          <ul className="credits-list" aria-label="authors">
            {authors.map((c) => (
              <li key={c.author}>
                <span className="credits-name">{c.author}</span>
                <span className="credits-count">{count(c.count)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="credits-none">No authors named in the presets' file names yet.</p>
        )}
      </div>
    </div>
  );
}
