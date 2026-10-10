import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { LibraryChange } from './api.ts';
import { parseTags, type Prepared } from './librarySearch.ts';
import { tagCounts } from './PresetDrawer.tsx';
import { say } from './words.ts';

export interface TagEditorProps {
  /** The presets the tags are on: one, or several picked at once (a tag on only some shows its count). */
  chosen: readonly Prepared[];
  /** Change the tags on these preset keys. */
  onSet(keys: string[], change: LibraryChange): void;
  /** The group's class; the parts' classes are fixed (`now-chip`, `now-chip-count`, `now-chip-x`, `now-chip-add`, `now-tag-input`), scoped by the panel showing them. */
  className?: string;
  /** What the take-off button shows; "×" by default. */
  remove?: ReactNode;
}

/**
 * My tags on `chosen`, each removable, and "+ Tag", which becomes a text box
 * (Enter adds, commas split, Esc cancels). Today's Now Playing panel
 * (NowPanel.tsx) and the macOS layout's inspector both show it.
 */
export function TagEditor({ chosen, onSet, className = 'now-tags', remove = '×' }: TagEditorProps) {
  const [adding, setAdding] = useState(false);
  const [typing, setTyping] = useState('');
  const keys = chosen.map((p) => p.row.key);
  const tags = tagCounts(chosen);
  const n = chosen.length;

  // Esc closes the box; the blur that follows must not add what was typed.
  const cancelled = useRef(false);
  const commit = () => {
    if (cancelled.current) return;
    const add = parseTags(typing);
    if (add.length) onSet(keys, { add_tags: add });
    setTyping('');
    setAdding(false);
  };
  const onKey = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      commit();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      cancelled.current = true;
      setTyping('');
      setAdding(false);
    } else {
      return;
    }
    ev.stopPropagation();
  };

  return (
    <div className={className} role="group" aria-label={say('user tags')}>
      {tags.map(({ tag, count }) => (
        <span key={tag} className="now-chip" data-some={count < n ? '' : undefined} title={count < n ? `on ${count} of ${n}` : undefined}>
          {tag}
          {count < n && <span className="now-chip-count">{count}</span>}
          <button
            type="button"
            className="now-chip-x"
            aria-label={`take the tag ${tag} off${count < n ? ` (on ${count} of ${n})` : ''}`}
            title={`Take “${tag}” off${n > 1 ? ' all of them' : ''}`}
            onClick={() => onSet(keys, { remove_tags: [tag] })}
          >
            {remove}
          </button>
        </span>
      ))}
      {adding ? (
        <input
          className="now-chip now-tag-input"
          type="text"
          aria-label="add tags"
          placeholder="tags, split by commas"
          title={`Enter adds${n > 1 ? ' to all of them' : ''}, Esc cancels`}
          autoFocus
          value={typing}
          onChange={(ev) => setTyping(ev.target.value)}
          onKeyDown={onKey}
          onBlur={commit}
        />
      ) : (
        <button
          type="button"
          className="now-chip now-chip-add"
          title={`Add a tag${n > 1 ? ' to all of them' : ''}`}
          onClick={() => {
            cancelled.current = false;
            setAdding(true);
          }}
        >
          + Tag
        </button>
      )}
    </div>
  );
}
