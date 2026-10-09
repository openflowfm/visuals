import { useRef, useState, type ReactNode } from 'react';
import { NumberField } from '@openflow/widgets/controls/NumberField.tsx';
import { Segmented } from '@openflow/widgets/controls/Segmented.tsx';
import type { Param } from '@openflow/widgets/param/param.ts';
import { plural } from './controls.ts';
import { changeUnit, NameEdit, playsLike, saveFile, withSetting, type StripTile } from './home.ts';
import { queryName } from './librarySearch.ts';
import * as pl from './playlists.ts';
import type { Lists, Playlist, PlaylistSettings } from './playlists.ts';
import { Popover } from './Popover.tsx';
import { say } from './words.ts';
import './playlisthead.css';

export interface PlaylistHeadProps {
  list: Playlist;
  /** All playlists and the deck. */
  lists: Lists;
  /** The strip's tiles, for the cover's first four thumbnails. */
  tiles: StripTile[];
  /** How many presets it holds (a smart one's matches). */
  total: number;
  onLists(lists: Lists): void;
  /** The playlist was deleted: the home shows the library. */
  onDeleted(): void;
  onError(what: string): (e: unknown) => void;
  /** Shown above the caps label in a narrow window: the source menu, or nothing. */
  menu?: ReactNode;
}

/**
 * The header over a playlist's strip on the home (decision 67): a cover of its
 * first four thumbnails, what it is, its name (double-click renames), a line on
 * how it plays, and its actions: play or stop, shuffle, how it plays (the
 * settings, in a popover) and more (rename, save to a file, delete).
 */
export function PlaylistHead({ list, lists, tiles, total, onLists, onDeleted, onError, menu }: PlaylistHeadProps) {
  const [naming, setNaming] = useState<string | null>(null);
  const nameEdit = useRef(new NameEdit()).current;
  const [deleting, setDeleting] = useState(false);
  const { playlists, deck } = lists;
  const active = deck.playlist === list.id;
  const manual = list.kind === 'manual';
  const empty = manual && !list.items.length;
  const run = (p: Promise<Lists | void>, what: string) => p.then((l) => l && onLists(l), onError(what));

  const startNaming = () => {
    nameEdit.open();
    setNaming(list.name);
  };
  const commitName = () => {
    const name = nameEdit.commit(naming, list.name);
    setNaming(null);
    if (name) run(pl.rename(list.id, name), 'rename the playlist');
  };
  const set = (next: PlaylistSettings) => {
    onLists({ ...lists, playlists: playlists.map((p) => (p.id === list.id ? { ...p, settings: next } : p)) });
    run(pl.setSettings(list.id, next), 'change the playlist’s settings');
  };
  const play = () => run(pl.act({ kind: 'load', playlist: playlists.indexOf(list), index: null }), `play ${list.name}`);
  const stop = () => run(pl.act({ kind: 'unload' }), 'stop the playlist');
  const exportIt = () => pl.exportList(list.id).then((f) => saveFile(f.file_name, f.text), onError(`save ${list.name} to a file`));
  const shuffled = list.settings.order === 'shuffle';

  const summary =
    (manual ? '' : `fills itself with ${list.query ? queryName(list.query) : 'nothing'} · `) +
    playsLike(list, total) +
    (active && deck.index !== null ? ` · playing ${deck.index + 1} of ${manual ? list.items.length : deck.count}` : '');
  const cover = [0, 1, 2, 3].map((i) => tiles[i]?.thumbnail ?? null);

  return (
    <header className="pl-head">
      <div className="pl-cover" aria-hidden="true">
        {cover.map((src, i) => (
          <div key={i}>{src && <img src={src} alt="" decoding="async" draggable={false} />}</div>
        ))}
      </div>
      <div className="pl-head-text">
        {menu}
        <div className="pl-caps">{manual ? 'Playlist' : 'Smart playlist'}</div>
        {naming !== null ? (
          <input
            className="pl-name-input"
            aria-label="playlist name"
            autoFocus
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              else if (e.key === 'Escape') {
                nameEdit.cancel();
                setNaming(null);
              }
            }}
          />
        ) : (
          <h1 className="pl-name" title="Double-click to rename" onDoubleClick={startNaming}>
            {list.name}
          </h1>
        )}
        <div className="pl-summary" title={summary}>
          {summary}
        </div>
        <div className="pl-acts">
          {active ? (
            <button type="button" className="pl-btn" data-on="" onClick={stop} title="Stop: ← → step through the library again">
              ■ stop
            </button>
          ) : (
            <button type="button" className="pl-btn" data-on="" onClick={play} disabled={empty} title={empty ? 'Add presets to play it' : `Play ${list.name}`}>
              ▶ play
            </button>
          )}
          <button
            type="button"
            className="pl-btn"
            aria-pressed={shuffled}
            onClick={() => set(withSetting(list.settings, 'order', shuffled ? 'in_order' : 'shuffle'))}
            title="Play this playlist shuffled (it keeps this)"
          >
            shuffle
          </button>
          <Popover className="pl-pop" name={say('playlist settings')} label={`${say('playlist settings')} ▾`} title="How often it moves on, in what order, the crossfade and the look it sets">
            <SettingsBar settings={list.settings} differs={active ? deck.differs : []} onChange={set} />
          </Popover>
          {deleting ? (
            <span className="pl-confirm" onKeyDown={(e) => e.key === 'Escape' && setDeleting(false)}>
              <button
                type="button"
                className="pl-btn"
                data-danger=""
                autoFocus
                onClick={() => {
                  setDeleting(false);
                  onDeleted();
                  run(pl.remove(list.id), 'delete the playlist');
                }}
                title={`Delete ${list.name} for good`}
              >
                delete {list.name}?
              </button>
              <button type="button" className="pl-btn" onClick={() => setDeleting(false)} title="Keep the playlist">
                keep
              </button>
            </span>
          ) : (
            <Popover className="pl-pop pl-more" name="more" label="···" role="menu" align="left" title="Rename, save to a file or delete">
              {(close) => (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close();
                      startNaming();
                    }}
                  >
                    rename
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    title="Save to a file, to keep or to give someone: its presets by name and content"
                    onClick={() => {
                      close();
                      exportIt();
                    }}
                  >
                    save to a file
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    data-danger=""
                    title="Delete the playlist (asks first)"
                    onClick={() => {
                      close();
                      setDeleting(true);
                    }}
                  >
                    delete…
                  </button>
                </>
              )}
            </Popover>
          )}
        </div>
      </div>
    </header>
  );
}

const EVERY_S: Param = { kind: 'int', min: 1, max: 3600, defaultValue: 30, exponent: 2, name: 'every', customUnit: 's', unit: 'custom' };
const EVERY_BARS: Param = { kind: 'int', min: 1, max: 64, defaultValue: 8, steps: 64, name: 'every', customUnit: 'bars', unit: 'custom' };
const CROSSFADE: Param = { kind: 'float', min: 0, max: 10, defaultValue: 2, steps: 21, name: 'crossfade' };
const SPEED: Param = { kind: 'float', min: 0.25, max: 4, defaultValue: 1, exponent: 2, name: 'speed' };
const TRAILS: Param = { kind: 'float', min: 0, max: 1, defaultValue: 0, steps: 101, name: 'trails' };
const HUE: Param = { kind: 'float', min: 0, max: 1, defaultValue: 0, steps: 361, name: 'colour shift' };

/** How a playlist plays: how often it moves on, in what order, the crossfade, and the look it sets. */
export function SettingsBar({ settings, differs, onChange }: { settings: PlaylistSettings; differs: readonly string[]; onChange(next: PlaylistSettings): void }) {
  const tweaked = (name: string) => (differs.includes(name) ? 'changed live; this playlist’s own value comes back when it loads again' : undefined);
  const { change } = settings;
  return (
    <div className="home-settings" role="group" aria-label="how it plays">
      {/* Each control names itself (a `<label>` can't label the widgets' sliders and radio groups); the words beside them are for the eye. */}
      <div className="home-setting" role="group" aria-label={say('auto-advance')} data-tweaked={tweaked('change') ? '' : undefined} title={tweaked('change')}>
        <span aria-hidden="true">{say('auto-advance')} every</span>
        <NumberField
          label={`${say('auto-advance')} every, in ${change.unit === 'bars' ? 'bars' : 'seconds'}`}
          param={change.unit === 'bars' ? EVERY_BARS : EVERY_S}
          value={change.every}
          onChange={(v) => onChange(withSetting(settings, 'change', { unit: change.unit, every: v }))}
          display={change.unit === 'off' ? say('auto-advance off') : change.unit === 'bars' ? plural(Math.round(change.every), 'bar') : `${Math.round(change.every)} s`}
          title={change.unit === 'off' ? say('auto-advance off hint') : change.unit === 'bars' ? "Bars of Ableton Link's beat on each preset" : 'Seconds on each preset'}
        />
        <Segmented
          items={['s', 'bars', say('auto-advance off')]}
          itemLabels={[say('auto-advance seconds')]}
          index={change.unit === 'off' ? 2 : change.unit === 'bars' ? 1 : 0}
          onChange={(i) => onChange(changeUnit(settings, i === 2 ? 'off' : i === 1 ? 'bars' : 'seconds'))}
          label="seconds, bars or off"
          hint={`seconds, bars of the beat when you keep in time with Ableton, or ${say('auto-advance off')}`}
        />
      </div>
      <div className="home-setting" data-tweaked={tweaked('order') ? '' : undefined}>
        <Segmented
          items={['in order', 'shuffle']}
          index={settings.order === 'shuffle' ? 1 : 0}
          onChange={(i) => onChange(withSetting(settings, 'order', i === 1 ? 'shuffle' : 'in_order'))}
          label="order"
          hint="play in the order listed, or shuffled"
        />
      </div>
      <Setting name="crossfade" tweak={tweaked('transition')}>
        <NumberField
          label="crossfade"
          param={CROSSFADE}
          value={settings.transition}
          onChange={(v) => onChange(withSetting(settings, 'transition', v))}
          display={`${settings.transition.toFixed(1)} s`}
          title="Seconds one preset fades into the next"
        />
      </Setting>
      <Setting name="speed" tweak={tweaked('speed')}>
        <NumberField
          label="speed"
          param={SPEED}
          value={settings.speed}
          onChange={(v) => onChange(withSetting(settings, 'speed', v))}
          display={`${settings.speed.toFixed(2)}×`}
          title="How fast the presets move"
        />
      </Setting>
      <Setting name="trails" tweak={tweaked('trails')}>
        <NumberField
          label="trails"
          param={TRAILS}
          value={settings.trails}
          onChange={(v) => onChange(withSetting(settings, 'trails', v))}
          display={`${Math.round(settings.trails * 100)}%`}
          title="How long each frame lingers"
        />
      </Setting>
      <Setting name="colour shift" tweak={tweaked('hue')}>
        <NumberField
          label="colour shift"
          param={HUE}
          value={settings.hue}
          onChange={(v) => onChange(withSetting(settings, 'hue', v))}
          display={`${Math.round(settings.hue * 360)}°`}
          title="Turn every colour round the colour wheel"
        />
      </Setting>
    </div>
  );
}

function Setting({ name, tweak, children }: { name: string; tweak?: string; children: ReactNode }) {
  return (
    <div className="home-setting" data-tweaked={tweak ? '' : undefined} title={tweak}>
      <span aria-hidden="true">{name}</span>
      {children}
    </div>
  );
}
