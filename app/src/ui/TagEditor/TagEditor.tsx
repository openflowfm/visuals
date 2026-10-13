import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Text } from '@satoramoto/zen';
import type { LibraryChange } from '../model/api';
import { parseTags, type Prepared } from '../model/librarySearch';
import { tagCounts } from '../PresetDrawer/PresetDrawer';
import { say } from '../model/words';
import './TagEditor.css';

export interface TagEditorProps {
  /** The presets the tags are on: one, or several picked at once (a tag on only some shows its count). */
  chosen: readonly Prepared[];
  /** Change the tags on these preset keys. */
  onSet(keys: string[], change: LibraryChange): void;
  /** What the take-off button shows; "×" by default. */
  remove?: ReactNode;
}

/**
 * **Job.** My tags on `chosen`, each removable, and "+ Tag", which becomes a text box (Enter adds,
 * commas split, Esc cancels). The inspector shows it.
 *
 * **Changed.** Classes are `vs-tag-editor`, `vs-tag-chip`, `vs-tag-chip-count`, `vs-tag-chip-x`,
 * `vs-tag-chip-add`, `vs-tag-chip-input` (the original's without `vs-`). The focus ring, which
 * the original took from access.css, is drawn here in `--vs-focus-ring`. The box is the filled
 * field on `--radius-input`.
 *
 * **Kept.** Tags as type ("#tag", no pill), ✕ on hover or focus, a tag on only some fainter with
 * its count, the props, the keys, the copy, the labels and titles.
 *
 * **Tuning knobs.** `--vs-tag-x-radius` (the ✕'s 4px corners, half of `--radius-control`).
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
    <Text as="div" className="vs-tag-editor" ariaRole="group" aria-label={say('user tags')}>
      {tags.map(({ tag, count }) => (
        <Text key={tag} className="vs-tag-chip" data-some={count < n ? '' : undefined} title={count < n ? `on ${count} of ${n}` : undefined}>
          {tag}
          {count < n && (
            <Text tabular className="vs-tag-chip-count">
              {count}
            </Text>
          )}
          <button
            type="button"
            className="vs-tag-chip-x"
            aria-label={`take the tag ${tag} off${count < n ? ` (on ${count} of ${n})` : ''}`}
            title={`Take “${tag}” off${n > 1 ? ' all of them' : ''}`}
            onClick={() => onSet(keys, { remove_tags: [tag] })}
          >
            {remove}
          </button>
        </Text>
      ))}
      {adding ? (
        <input
          className="vs-tag-chip vs-tag-chip-input"
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
        <Text
          as="button"
          type="button"
          className="vs-tag-chip vs-tag-chip-add"
          title={`Add a tag${n > 1 ? ' to all of them' : ''}`}
          onClick={() => {
            cancelled.current = false;
            setAdding(true);
          }}
        >
          + Tag
        </Text>
      )}
    </Text>
  );
}
