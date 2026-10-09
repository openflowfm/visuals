import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { NumberField } from '@openflow/widgets/controls/NumberField.tsx';
import { Toggle } from '@openflow/widgets/controls/Toggle.tsx';
import type { Param } from '@openflow/widgets/param/param.ts';
import * as pl from './playlists.ts';
import type { Lists } from './playlists.ts';
import { plural } from './controls.ts';
import { notice, type Notice } from './shell.ts';
import { say } from './words.ts';
import { beginDrag, dropAction, isOver, itemTarget, listTarget, nudge, runDrop, useDrag, type DragHandlers } from './drag.ts';
import './playlists.css';

/** Whether there is anything to play: a smart playlist picks its own when it loads, so it always may. */
const playable = (p: pl.Playlist) => p.kind === 'smart' || p.items.length > 0;

interface Props {
  lists: Lists;
  /** The preset on the bench, by path. */
  current: string | null;
  /** The playlist being shown and edited; the library's + adds to it. */
  selected: string | null;
  onSelect(id: string | null): void;
  onLists(next: Lists): void;
  /** A failure for the page to show: a short sentence, and what the app said, for its tooltip. */
  onError(notice: Notice): void;
  /** A library with a + per row sits beside the panel (the editor's does; live mode has none). */
  library?: boolean;
}

const SECONDS: Param = { kind: 'int', min: 1, max: 600, defaultValue: 30, steps: 600, name: 'every', customUnit: 's', unit: 'custom' };

/** A playlist row's spoken name: its name, how many presets, and whether it's playing. */
export const listSays = (p: pl.Playlist, playing: boolean): string => `${p.name}, ${p.kind === 'smart' ? 'smart playlist' : plural(p.items.length, 'preset')}${playing ? ', playing' : ''}`;

/** An item row's spoken name: its place, its name, its group or that it's missing, and whether it's playing. */
export const itemSays = (i: number, item: pl.Playlist['items'][number], playing: boolean): string =>
  `${i + 1}. ${item.name}, ${item.missing ? 'missing, file not found' : item.group}${playing ? ', playing' : ''}`;

/** Enter or space on a row, as a click. */
const onActivate = (f: () => void) => (e: KeyboardEvent) => {
  if (e.target !== e.currentTarget) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    f();
  }
};

/**
 * Playlists: pick one, edit it, play it. Playing one makes ← → and auto-advance
 * step through it instead of the library; every live change goes through `act`.
 *
 * It styles itself wherever it is put — the editor's library column and live
 * mode's side panel — so none of its rules hang off the container.
 */
export function Playlists({ lists, current, selected, onSelect, onLists, onError, library = true }: Props) {
  const [naming, setNaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const confirm = useRef<HTMLSpanElement>(null);
  // The confirm step takes the focus, so a keyboard can answer it and leaving it cancels.
  useEffect(() => {
    if (deleting) confirm.current?.querySelector('button')?.focus();
  }, [deleting]);
  const { playlists, deck } = lists;
  const at = playlists.findIndex((p) => p.id === selected);
  const list = at >= 0 ? playlists[at] : null;
  const active = list !== null && deck.playlist === list.id;

  const fail = (what: string) => (e: unknown) => onError(notice(`Couldn't ${what}.`, e));
  const run = (p: Promise<Lists | void>, what: string) =>
    p.then((l) => {
      if (l) onLists(l);
    }, fail(what));

  // Dragging an item: onto another place in its playlist moves it, onto another playlist's name copies it there.
  const drag = useDrag();
  const dropping: DragHandlers = {
    accepts: (target, payload) => dropAction(payload, target, playlists) !== null,
    onDrop: (target, payload) => {
      const a = dropAction(payload, target, playlists);
      if (a) run(runDrop(a), a.kind === 'move' ? 'move the preset' : 'add the preset');
    },
  };

  const play = (n: number, index: number | null = null) => run(pl.act({ kind: 'load', playlist: n, index }), 'play that');
  const stop = () => run(pl.act({ kind: 'unload' }), 'stop the playlist');

  const create = () =>
    pl.create(pl.freshName(playlists)).then((l) => {
      onLists(l);
      const made = l.playlists[l.playlists.length - 1];
      onSelect(made.id);
      setNaming({ id: made.id, name: made.name });
    }, fail('make a playlist'));

  const commitName = () => {
    if (!naming) return;
    const { id, name } = naming;
    setNaming(null);
    if (name.trim()) run(pl.rename(id, name.trim()), 'rename the playlist');
  };

  return (
    <div className="playlists">
      <div className="playlists-bar">
        <Button onPress={create} title="Make a new, empty playlist">
          new
        </Button>
        <Button disabled={!list} onPress={() => list && setNaming({ id: list.id, name: list.name })} title="Rename the selected playlist">
          rename
        </Button>
        {list && deleting === list.id ? (
          <span
            ref={confirm}
            className="playlists-confirm"
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDeleting(null);
            }}
            onKeyDown={(e) => e.key === 'Escape' && setDeleting(null)}
          >
            <Button
              tone="danger"
              className="playlists-danger"
              onPress={() => {
                setDeleting(null);
                onSelect(null);
                run(pl.remove(list.id), 'delete the playlist');
              }}
              title={`Delete ${list.name} for good`}
            >
              delete {plural(list.items.length, 'item')}?
            </Button>
            <Button onPress={() => setDeleting(null)} title="Keep the playlist">
              keep
            </Button>
          </span>
        ) : (
          <Button disabled={!list} onPress={() => list && setDeleting(list.id)} title="Delete the selected playlist (asks first)">
            delete
          </Button>
        )}
      </div>
      <ul className="playlists-names" aria-label="playlists">
        {playlists.length === 0 && (
          <li className="playlists-empty">
            No playlists yet. <b>new</b> makes one; then add presets to it with <b>+ current</b>
            {library ? (
              <>
                , or <b>+</b> beside a preset in the library
              </>
            ) : null}
            .
          </li>
        )}
        {playlists.map((p, n) => {
          const on = p.id === deck.playlist;
          return (
            <li
              key={p.id}
              className="playlists-row"
              tabIndex={naming?.id === p.id ? -1 : 0}
              aria-current={p.id === selected ? 'true' : undefined}
              data-selected={p.id === selected ? '' : undefined}
              data-active={on ? '' : undefined}
              data-drop={listTarget(p.id)}
              data-over={isOver(drag, listTarget(p.id)) ? '' : undefined}
              aria-label={naming?.id === p.id ? undefined : listSays(p, on)}
              onClick={() => onSelect(p.id)}
              onDoubleClick={() => play(n)}
              onKeyDown={onActivate(() => onSelect(p.id))}
              title={on ? `${p.name} is playing` : `${p.name} — play it with ▶, or double-click`}
            >
              {naming?.id === p.id ? (
                <input
                  className="playlists-rename"
                  aria-label="playlist name"
                  autoFocus
                  value={naming.name}
                  onChange={(e) => setNaming({ id: p.id, name: e.target.value })}
                  onBlur={commitName}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitName();
                    else if (e.key === 'Escape') setNaming(null);
                  }}
                />
              ) : (
                <>
                  <span className="playlists-play" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                    {on ? (
                      <Button tone="quiet" className="playlists-on" onPress={stop} label={`Stop ${p.name}`} title="Stop: ← → step through the library again">
                        ■
                      </Button>
                    ) : (
                      <Button tone="quiet" onPress={() => play(n)} disabled={!playable(p)} label={`Play ${p.name}`} title={playable(p) ? `Play ${p.name} from the top` : `${p.name} is empty`}>
                        ▶
                      </Button>
                    )}
                  </span>
                  <span className="playlists-name">{p.name}</span>
                  <i aria-hidden="true">{p.items.length}</i>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {list && (
        <>
          <div className="playlists-bar">
            {active ? (
              <Button className="playlists-on" onPress={stop} title="Stop the playlist: ← → step through the library again">
                stop
              </Button>
            ) : (
              <Button onPress={() => play(at)} disabled={!playable(list)} title={playable(list) ? `Play ${list.name} from the top` : 'Add presets to play it'}>
                play
              </Button>
            )}
            <Button disabled={!current} onPress={() => current && run(pl.add(list.id, current), 'add the preset')} title={`Add the preset that's playing to ${list.name}`}>
              + current
            </Button>
            <span className="vf-fill" />
            <span className="playlists-count">{active && deck.index !== null ? `${deck.index + 1} / ${list.items.length}` : plural(list.items.length, 'preset')}</span>
          </div>
          <ol className="playlists-items" aria-label={`${list.name}, in order`}>
            {list.items.length === 0 && (
              <li className="playlists-empty">
                {list.name} is empty. <b>+ current</b> adds the preset that's playing
                {library ? (
                  <>
                    ; <b>+</b> beside a preset in the library adds that one
                  </>
                ) : null}
                .
              </li>
            )}
            {list.items.map((item, i) => {
              const open = () => run(pl.act(active ? { kind: 'go', index: i } : { kind: 'load', playlist: at, index: i }), `open ${item.name}`);
              const target = itemTarget(list.id, i);
              return (
                <li
                  key={`${i}:${item.path}`}
                  className="playlists-row"
                  tabIndex={0}
                  aria-current={active && deck.index === i ? 'true' : undefined}
                  data-current={active && deck.index === i ? '' : undefined}
                  data-missing={item.missing ? '' : undefined}
                  data-drop={target}
                  data-over={isOver(drag, target) ? (drag?.payload.kind === 'item' && drag.payload.list === list.id && drag.payload.index < i ? 'after' : 'before') : undefined}
                  data-dragged={drag?.payload.kind === 'item' && drag.payload.list === list.id && drag.payload.index === i ? '' : undefined}
                  aria-label={itemSays(i, item, active && deck.index === i)}
                  onClick={open}
                  onPointerDown={(e) => beginDrag(e, { kind: 'item', list: list.id, index: i, path: item.path, name: item.name, thumbnail: null }, dropping)}
                  onKeyDown={(e) => {
                    const by = e.altKey && e.key === 'ArrowUp' ? -1 : e.altKey && e.key === 'ArrowDown' ? 1 : 0;
                    const to = by && e.target === e.currentTarget ? nudge(i, by, list.items.length) : null;
                    if (to === null) return onActivate(open)(e);
                    e.preventDefault();
                    e.stopPropagation();
                    const rows = e.currentTarget.parentElement;
                    run(pl.moveItem(list.id, i, to), 'move the preset').then(() => requestAnimationFrame(() => (rows?.children[to] as HTMLElement | undefined)?.focus()));
                  }}
                  title={item.missing ? `Not in the library any more: ${item.path}. Put the file back, or remove it here.` : `${item.path} — click or Enter to play; drag, or ⌥↑ ⌥↓, to move it`}
                >
                  <span className="playlists-grip" aria-hidden="true">
                    ⋮⋮
                  </span>
                  <b>{i + 1}</b>
                  <span className="playlists-item">
                    <span>{item.name}</span>
                    <i>{item.missing ? 'missing — file not found' : item.group}</i>
                  </span>
                  <span className="playlists-tools" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                    <Button tone="quiet" onPress={() => run(pl.removeItem(list.id, i), 'remove the preset')} label={`Remove ${item.name} from ${list.name}`} title="Remove from the playlist">
                      ✕
                    </Button>
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}
      <div className="playlists-auto">
        <Toggle on={deck.auto} onChange={(on) => run(pl.act({ kind: 'auto', on }), 'turn auto-advance ' + (on ? 'on' : 'off'))} layout="inside" name={say('auto-advance')} label={say('auto-advance')}>
          {deck.auto ? 'on' : 'off'}
        </Toggle>
        <NumberField
          param={SECONDS}
          value={deck.seconds}
          onChange={(v) => {
            const seconds = Math.round(v);
            onLists({ ...lists, deck: { ...deck, seconds } });
            run(pl.act({ kind: 'seconds', seconds }), 'change the seconds');
          }}
          display={`${Math.round(deck.seconds)} s`}
          label="seconds on each preset"
          title="Seconds on each preset before auto-advance moves on"
        />
      </div>
    </div>
  );
}
