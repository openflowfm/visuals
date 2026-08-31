import { useState, type KeyboardEvent } from 'react';
import { TAG_BY_ID, TAG_CATEGORIES, TAGS, type LabTag } from '../../lab.ts';

/**
 * The tag vocabulary as one control: what this review says, and the shelves
 * for saying more. Shared by the train view, which tags a judgment as it
 * happens, and the review tab, which revises the description afterwards —
 * two copies of the picker would be two definitions of how tagging feels.
 *
 * Keyboard-first: type to filter, ⏎ adds the ringed top match and clears,
 * Escape clears. Anything else a view wants from the box — the train view
 * scores on 1–5 and submits on ⌘⏎ — comes in through `onKeyExtra`, which
 * runs first and wins by returning true.
 */
export function TagPicker({
  chosen,
  toggle,
  placeholder,
  autoFocus,
  onKeyExtra,
}: {
  chosen: readonly string[];
  toggle(id: string): void;
  placeholder: string;
  autoFocus?: boolean;
  onKeyExtra?(event: KeyboardEvent<HTMLInputElement>, search: string): boolean;
}) {
  const [search, setSearch] = useState('');
  const looking = search.trim().toLowerCase();
  const has = new Set(chosen);

  const seeks = (tag: LabTag) =>
    tag.active &&
    (!looking ||
      tag.label.toLowerCase().includes(looking) ||
      tag.description.toLowerCase().includes(looking));
  /** What ⏎ would add: the first match in shelf order, shown with a focus ring. */
  const topMatch = looking ? (TAGS.find(seeks) ?? null) : null;

  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (onKeyExtra?.(event, search)) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (topMatch) {
        toggle(topMatch.id);
        setSearch('');
      }
      return;
    }
    if (event.key === 'Escape') setSearch('');
  };

  const chip = (tag: LabTag, top: boolean) => (
    <button
      key={tag.id}
      type="button"
      className="tag-chip"
      data-on={has.has(tag.id) ? '' : undefined}
      data-top={top ? '' : undefined}
      data-polarity={tag.polarity === 'neutral' ? undefined : tag.polarity}
      title={tag.description}
      onClick={() => toggle(tag.id)}
    >
      {tag.label}
    </button>
  );

  return (
    <div className="tagpick">
      {chosen.length > 0 && (
        <section className="tagpick-chosen">
          <h3>this review says</h3>
          <div className="tag-chips">
            {chosen.map((id) => {
              const tag = TAG_BY_ID.get(id);
              return tag ? chip(tag, false) : null;
            })}
          </div>
        </section>
      )}
      <section className="tagpick-all">
        <input
          value={search}
          autoFocus={autoFocus}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={keys}
          placeholder={placeholder}
          aria-label="Filter tags"
        />
        {TAG_CATEGORIES.map(({ category, about }) => {
          const rows = TAGS.filter((tag) => tag.category === category && seeks(tag));
          if (rows.length === 0) return null;
          return (
            <div key={category} className="tag-shelf">
              <h4 title={about}>{category}</h4>
              <div className="tag-chips">
                {rows.map((tag) => chip(tag, topMatch?.id === tag.id))}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
