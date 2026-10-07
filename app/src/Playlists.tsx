import { useState } from 'react';
import { NumberField } from '@openflow/widgets/controls/NumberField.tsx';
import { Toggle } from '@openflow/widgets/controls/Toggle.tsx';
import type { Param } from '@openflow/widgets/param/param.ts';
import * as pl from './playlists.ts';
import type { Lists } from './playlists.ts';
import './playlists.css';

interface Props {
  lists: Lists;
  /** The preset on the bench, by path. */
  current: string | null;
  /** The playlist being shown and edited; the library's + adds to it. */
  selected: string | null;
  onSelect(id: string | null): void;
  onLists(next: Lists): void;
  onError(message: string): void;
}

const SECONDS: Param = { kind: 'int', min: 1, max: 600, defaultValue: 30, steps: 600, name: 'every', customUnit: 's', unit: 'custom' };

/**
 * Playlists: pick one, edit it, play it. Playing one makes ← → and auto-advance
 * step through it instead of the library; every live change goes through `act`.
 */
export function Playlists({ lists, current, selected, onSelect, onLists, onError }: Props) {
  const [naming, setNaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const { playlists, deck } = lists;
  const at = playlists.findIndex((p) => p.id === selected);
  const list = at >= 0 ? playlists[at] : null;
  const active = list !== null && deck.playlist === list.id;

  const run = (p: Promise<Lists | void>) =>
    p.then((l) => {
      if (l) onLists(l);
    }, (e) => onError(String(e)));

  const create = () =>
    pl.create(`playlist ${playlists.length + 1}`).then((l) => {
      onLists(l);
      const made = l.playlists[l.playlists.length - 1];
      onSelect(made.id);
      setNaming({ id: made.id, name: made.name });
    }, (e) => onError(String(e)));

  const commitName = () => {
    if (!naming) return;
    const { id, name } = naming;
    setNaming(null);
    if (name.trim()) run(pl.rename(id, name));
  };

  return (
    <div className="playlists">
      <div className="playlists-bar">
        <button onClick={create} title="new playlist">new</button>
        <button disabled={!list} onClick={() => list && setNaming({ id: list.id, name: list.name })}>rename</button>
        {deleting && deleting === list?.id ? (
          <button
            className="danger"
            onClick={() => {
              setDeleting(null);
              onSelect(null);
              run(pl.remove(list.id));
            }}
            onBlur={() => setDeleting(null)}
            autoFocus
          >
            delete {list.items.length} items?
          </button>
        ) : (
          <button disabled={!list} onClick={() => list && setDeleting(list.id)}>delete</button>
        )}
      </div>
      <ul className="playlists-names">
        {playlists.length === 0 && <li className="quiet">no playlists yet</li>}
        {playlists.map((p, n) => (
          <li
            key={p.id}
            data-selected={p.id === selected ? '' : undefined}
            data-active={p.id === deck.playlist ? '' : undefined}
            onClick={() => onSelect(p.id)}
            onDoubleClick={() => run(pl.act({ kind: 'load', playlist: n, index: null }))}
            title="double-click to play"
          >
            {naming?.id === p.id ? (
              <input
                autoFocus
                value={naming.name}
                onChange={(e) => setNaming({ id: p.id, name: e.target.value })}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitName();
                  else if (e.key === 'Escape') setNaming(null);
                }}
              />
            ) : (
              <>
                <span className="playlists-mark">{p.id === deck.playlist ? '▶' : ''}</span>
                <span className="playlists-name">{p.name}</span>
                <i>{p.items.length}</i>
              </>
            )}
          </li>
        ))}
      </ul>
      {list && (
        <>
          <div className="playlists-bar">
            {active ? (
              <button data-on="" onClick={() => run(pl.act({ kind: 'unload' }))} title="step through the library again">
                stop
              </button>
            ) : (
              <button onClick={() => run(pl.act({ kind: 'load', playlist: at, index: null }))} disabled={!list.items.length}>
                play
              </button>
            )}
            <button disabled={!current} onClick={() => current && run(pl.add(list.id, current))} title="add the preset on the bench">
              + current
            </button>
            <span className="fill" />
            <span className="quiet">
              {active && deck.index !== null ? `${deck.index + 1} / ${list.items.length}` : `${list.items.length} presets`}
            </span>
          </div>
          <ol className="playlists-items">
            {list.items.length === 0 && <li className="quiet">add presets with + current, or + in the library</li>}
            {list.items.map((item, i) => (
              <li
                key={`${i}:${item.path}`}
                data-current={active && deck.index === i ? '' : undefined}
                data-missing={item.missing ? '' : undefined}
                onClick={() => run(pl.act(active ? { kind: 'go', index: i } : { kind: 'load', playlist: at, index: i }))}
                title={item.missing ? `missing: ${item.path}` : item.path}
              >
                <b>{i + 1}</b>
                <span className="playlists-item">
                  <span>{item.name}</span>
                  <i>{item.group}</i>
                </span>
                <span className="playlists-tools" onClick={(e) => e.stopPropagation()}>
                  <button disabled={i === 0} onClick={() => run(pl.moveItem(list.id, i, i - 1))} title="move up">↑</button>
                  <button disabled={i === list.items.length - 1} onClick={() => run(pl.moveItem(list.id, i, i + 1))} title="move down">↓</button>
                  <button onClick={() => run(pl.removeItem(list.id, i))} title="remove">✕</button>
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
      <div className="playlists-auto">
        <Toggle on={deck.auto} onChange={(on) => run(pl.act({ kind: 'auto', on }))} layout="inside" name="auto-advance" label="auto-advance">
          {deck.auto ? 'on' : 'off'}
        </Toggle>
        <NumberField
          param={SECONDS}
          value={deck.seconds}
          onChange={(v) => {
            const seconds = Math.round(v);
            onLists({ ...lists, deck: { ...deck, seconds } });
            run(pl.act({ kind: 'seconds', seconds }));
          }}
          display={`${Math.round(deck.seconds)} s`}
          title="seconds on each preset"
        />
      </div>
    </div>
  );
}
