import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { LibraryChange } from './api.ts';
import { parseTags, type Prepared } from './librarySearch.ts';
import { tagCounts } from './PresetDrawer.tsx';
import { say } from './words.ts';
import './tag-editor.css';

export interface TagEditorProps {
  /** The presets the tags are on: one, or several picked at once (a tag on only some shows its count). */
  chosen: readonly Prepared[];
  /** Change the tags on these preset keys. */
  onSet(keys: string[], change: LibraryChange): void;
  /** What the take-off button shows; "×" by default. */
  remove?: ReactNode;
}

/**
 * My tags on `chosen`, each removable, and "+ Tag", which becomes a text box
 * (Enter adds, commas split, Esc cancels). The inspector shows it; its look is
 * tag-editor.css (`tag-editor`, `tag-chip`, `tag-chip-count`, `tag-chip-x`,
 * `tag-chip-add`, `tag-chip-input`).
 */
export function TagEditor({ chosen, onSet, remove = '×' }: TagEditorProps) {
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
    <div className="tag-editor" role="group" aria-label={say('user tags')}>
      {tags.map(({ tag, count }) => (
        <span key={tag} className="tag-chip" data-some={count < n ? '' : undefined} title={count < n ? `on ${count} of ${n}` : undefined}>
          {tag}
          {count < n && <span className="tag-chip-count">{count}</span>}
          <button
            type="button"
            className="tag-chip-x"
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
          className="tag-chip tag-chip-input"
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
          className="tag-chip tag-chip-add"
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
