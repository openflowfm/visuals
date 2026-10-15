import { useRef, useState, type ReactNode } from 'react';
import { NumberField } from '@satoramoto/zen';
import { Segmented } from '@satoramoto/zen';
import type { Param } from '@satoramoto/zen';
import { Group } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import { plural } from '../model/controls';
import { changeUnit, movesOn, NameEdit, playsLike, saveFile, withSetting, type StripTile } from '../model/home';
import { offersQuickAdd } from '../model/home-model';
import { queryName } from '../model/librarySearch';
import * as pl from '../model/playlists';
import type { Lists, Playlist, PlaylistSettings } from '../model/playlists';
import { MoreDots, Popover } from '../Popover/Popover';
import { say, Say } from '../model/words';
import './PlaylistHead.css';

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
  /** Where it shows: over the playlist's pane (`pane`, the default: a row, the name the pane's h1), or in the inspector (`inspector`: a card down the panel's width, the cover over the words, the name an h2, ⋯ at the card's top right with its menu hung from there, how it plays opening across the card). */
  variant?: 'pane' | 'inspector';
  /** Opens quick add on this playlist: an "Add presets" button, shown for a manual playlist (`offersQuickAdd`) when given. */
  onQuickAdd?: () => void;
}

/**
 * The header over a playlist's strip on the home (decision 67).
 *
 * **Job.** A cover of its first four thumbnails, what it is, its name (double-click renames), a
 * line on how it plays, and its actions: play or stop, shuffle, how it plays (the settings, in a
 * popover) and more (rename, save to a file, delete). In the inspector (`variant='inspector'`) a
 * vertical card with no playback controls: no play, stop or shuffle (shuffle is the order in how
 * it plays).
 *
 * **Changed.** The settings' number boxes and switches are the core `NumberField` and
 * `Segmented` (the widgets' ones, on the contract's materials), in a `Group` named "how it
 * plays". The popovers are the visuals `Popover`, so they float in the top layer as glass; in
 * the inspector, how it plays opens across the actions' width through its `across` (the original
 * did it by making its wrapper static). Type, sizes and colours are the contract's: the words
 * are `Text`s (the name `display` at the heading size, the caps and the summary `caption`, each
 * action's word a body Text inside its button), and the rename box takes the name's type from a
 * `Text` around it, since visuals.css resets a form control's font to its parent's.
 *
 * **Kept.** The props, the behaviour (rename with Esc that stops at the box, delete that asks
 * first, put back), every accessible name and title, all copy, and the look: on the window's
 * surface with no fill, on the pane's padding, actions as type with the one on underlined.
 */
export function PlaylistHead({ list, lists, tiles, total, onLists, onDeleted, onError, variant = 'pane', onQuickAdd }: PlaylistHeadProps) {
  const inspector = variant === 'inspector';
  const Name = inspector ? 'h2' : 'h1';
  const [naming, setNaming] = useState<string | null>(null);
  const nameEdit = useRef(new NameEdit()).current;
  const [deleting, setDeleting] = useState(false);
  const acts = useRef<HTMLDivElement>(null);
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
  const exportIt = () =>
    pl
      .exportList(list.id)
      .then((f) => saveFile(f.file_name, f.text))
      .catch(onError(`save ${list.name} to a file`));
  const shuffled = list.settings.order === 'shuffle';
  // Its timing changed live (the Link panel's, say): the summary says what is in effect, and Put back undoes it.
  const changedLive = pl.timingChangedLive(deck, list.id);
  const own = movesOn(list.settings.change);
  const putBack = () => run(pl.act({ kind: 'put_back' }), `put back ${list.name}’s timing`);

  const plays = playsLike(list, total);
  const summary =
    (manual ? '' : `fills itself with ${list.query ? queryName(list.query) : 'nothing'} · `) +
    (changedLive ? plays.replace(own, `${pl.movingOn(deck)} (changed live)`) : plays) +
    (active && deck.index !== null ? ` · playing ${deck.index + 1} of ${manual ? list.items.length : deck.count}` : '');
  const cover = [0, 1, 2, 3].map((i) => tiles[i]?.thumbnail ?? null);

  return (
    <header className="vs-playlisthead" data-variant={variant}>
      <div className="vs-playlisthead-cover" aria-hidden="true">
        {cover.map((src, i) => (
          <div key={i}>{src && <img src={src} alt="" decoding="async" draggable={false} />}</div>
        ))}
      </div>
      <div className="vs-playlisthead-text">
        <Text as="div" role="caption" className="vs-playlisthead-caps">
          {manual ? 'Playlist' : 'Smart playlist'}
        </Text>
        {naming !== null ? (
          // The box takes its type from this Text: visuals.css resets a form control's font to its parent's.
          <Text role="display" size="heading" className="vs-playlisthead-name-type">
            <input
              className="vs-playlisthead-name-input"
              aria-label="playlist name"
              autoFocus
              value={naming}
              onChange={(e) => setNaming(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName();
                else if (e.key === 'Escape') {
                  // Esc ends the rename only, not the inspector it may sit in.
                  e.preventDefault();
                  e.stopPropagation();
                  nameEdit.cancel();
                  setNaming(null);
                }
              }}
            />
          </Text>
        ) : (
          <Text as={Name} role="display" size="heading" weight={inspector ? 'strong' : undefined} className="vs-playlisthead-name" title="Double-click to rename" onDoubleClick={startNaming}>
            {list.name}
          </Text>
        )}
        <Text as="div" role="caption" tabular className="vs-playlisthead-summary" title={summary}>
          {summary}
        </Text>
        <div className="vs-playlisthead-acts" ref={acts}>
          {inspector ? null : active ? (
            <button type="button" className="vs-playlisthead-btn" data-on="" onClick={stop} title="Stop: ← → step through the library again">
              <Word>■ Stop</Word>
            </button>
          ) : (
            <button type="button" className="vs-playlisthead-btn" data-on="" onClick={play} disabled={empty} title={empty ? 'Add presets to play it' : `Play ${list.name}`}>
              <Word>▶ Play</Word>
            </button>
          )}
          {!inspector && (
            <button
              type="button"
              className="vs-playlisthead-btn"
              aria-pressed={shuffled}
              onClick={() => set(withSetting(list.settings, 'order', shuffled ? 'in_order' : 'shuffle'))}
              title="Play this playlist shuffled (it keeps this)"
            >
              <Word>Shuffle</Word>
            </button>
          )}
          {changedLive && (
            <button type="button" className="vs-playlisthead-btn" onClick={putBack} title={`Back to ${list.name}’s own timing: it ${own}`}>
              <Word>Put back</Word>
            </button>
          )}
          {onQuickAdd && offersQuickAdd(list) && (
            <button type="button" className="vs-playlisthead-btn" onClick={onQuickAdd} title={`Pick presets to add to ${list.name}`}>
              <Word>{Say('quickadd button')}</Word>
            </button>
          )}
          <Popover
            className="vs-playlisthead-pop"
            name={say('playlist settings')}
            label={<Word>{`${Say('playlist settings')} ▾`}</Word>}
            title="How often it moves on, in what order, the crossfade and the look it sets"
            across={inspector ? acts : undefined}
          >
            <SettingsBar settings={list.settings} differs={active ? deck.differs : []} onChange={set} />
          </Popover>
          {deleting ? (
            <span
              className="vs-playlisthead-confirm"
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return;
                e.preventDefault();
                e.stopPropagation();
                setDeleting(false);
              }}
            >
              <button
                type="button"
                className="vs-playlisthead-btn"
                data-danger=""
                autoFocus
                onClick={() => {
                  setDeleting(false);
                  onDeleted();
                  run(pl.remove(list.id), 'delete the playlist');
                }}
                title={`Delete ${list.name} for good`}
              >
                <Word>Delete {list.name}?</Word>
              </button>
              <button type="button" className="vs-playlisthead-btn" onClick={() => setDeleting(false)} title="Keep the playlist">
                <Word>Keep</Word>
              </button>
            </span>
          ) : (
            <Popover className="vs-playlisthead-pop vs-playlisthead-more" name="more" label={<MoreDots />} role="menu" align={inspector ? 'right' : 'left'} title="Rename, save to a file or delete">
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
                    Rename
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
                    Save to a file
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
                    Delete…
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

/**
 * How a playlist plays: how often it moves on, in what order, the crossfade, and the look it sets.
 *
 * **Changed.** The core `NumberField`s and `Segmented`s; the whole is a `Group` "how it plays"
 * (no label shown: the words beside the controls are for the eye). **Kept.** Every control's name,
 * hint and reading, and the mark on a setting changed live.
 */
export function SettingsBar({ settings, differs, onChange }: { settings: PlaylistSettings; differs: readonly string[]; onChange(next: PlaylistSettings): void }) {
  const tweaked = (name: string) => (differs.includes(name) ? 'changed live; this playlist’s own value comes back when it loads again' : undefined);
  const { change } = settings;
  return (
    <Group name="how it plays" label={false} wrap className="vs-playlisthead-settings">
      {/* Each control names itself (a `<label>` can't label the sliders and radio groups); the words beside them are for the eye. */}
      <Text as="div" role="caption" className="vs-playlisthead-setting" ariaRole="group" aria-label={say('auto-advance')} data-tweaked={tweaked('change') ? '' : undefined} title={tweaked('change')}>
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
      </Text>
      <Text as="div" role="caption" className="vs-playlisthead-setting" data-tweaked={tweaked('order') ? '' : undefined}>
        <Segmented
          items={['in order', 'shuffle']}
          index={settings.order === 'shuffle' ? 1 : 0}
          onChange={(i) => onChange(withSetting(settings, 'order', i === 1 ? 'shuffle' : 'in_order'))}
          label="order"
          hint="play in the order listed, or shuffled"
        />
      </Text>
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
    </Group>
  );
}

function Setting({ name, tweak, children }: { name: string; tweak?: string; children: ReactNode }) {
  return (
    <Text as="div" role="caption" className="vs-playlisthead-setting" data-tweaked={tweak ? '' : undefined} title={tweak}>
      <span aria-hidden="true">{name}</span>
      {children}
    </Text>
  );
}

/** An action's word (or glyph and word): a body Text at the original's 500, strong on the one on. */
function Word({ children }: { children: ReactNode }) {
  return <Text className="vs-playlisthead-word">{children}</Text>;
}
