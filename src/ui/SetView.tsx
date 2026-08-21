import { useState } from 'react';
import type { Scheme, SetGrid, Show } from '../../protocol.ts';
import { Button } from '../../../widgets/src/controls/Button.tsx';
import { NumberField } from '../../../widgets/src/controls/NumberField.tsx';
import { Select } from '../../../widgets/src/controls/Select.tsx';
import { Toggle } from '../../../widgets/src/controls/Toggle.tsx';
import { Colorways } from './Colorways.tsx';
import { lookList, toggleId } from './edits.ts';
import { newSeed, ROLL_ABOUT, ROLL_PARTS, rollScheme, type RollPart } from '../../roll.ts';
import { BARS, PACE } from './param.ts';

/**
 * The whole of what is left above the graph.
 *
 * This replaces a coverage matrix and a four-scope binding view, and the size
 * difference is the point rather than an accident of not having built it yet.
 * Both of those existed to navigate a cascade — every song against every track,
 * with four levels of override — and the cascade existed to combine pictures.
 * A graph combines pictures.
 *
 * So what a song can say is two things, both of them overrides: which colourway,
 * and which looks. Everything else is the **wheel**: a rig with nothing
 * configured turns through everything you have made, which is what makes it
 * something you can point at a set you have never seen.
 */
export function SetView({
  show,
  scheme,
  grid,
  save,
}: {
  show: Show;
  scheme: Scheme;
  grid: SetGrid | null;
  save(next: Scheme): void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const [parts, setParts] = useState<RollPart[]>([...ROLL_PARTS]);
  /**
   * The scheme as it was before the last roll, and one level is the right
   * number. A roll replaces a library, so the thing you want back is always the
   * thing you had a moment ago — and for anything older the seed is a better
   * answer than a stack, because it survives a reload.
   */
  const [before, setBefore] = useState<Scheme | null>(null);

  const looks = lookList(scheme);
  const ways = Object.keys(scheme.colorways);
  const songs = grid?.songs ?? show.songs.map((name) => ({ name, key: name, roles: [] }));

  const roll = (seed: string) => {
    if (parts.length === 0) return;
    setBefore(scheme);
    setTyped(null);
    save(rollScheme(seed, show, scheme, parts));
  };

  const rotate = (next: Partial<Scheme['rotation']>) =>
    save({ ...scheme, rotation: { ...scheme.rotation, ...next } });

  return (
    <div className="setview wdg">
      <div className="bar">
        <Button
          title={
            parts.length === ROLL_PARTS.length
              ? 'Deal a whole new library from a fresh seed'
              : `Deal ${parts.join(', ')} and leave the rest alone`
          }
          disabled={parts.length === 0}
          onPress={() => roll(newSeed())}
        >
          roll
        </Button>
        <span className="parts">
          {ROLL_PARTS.map((part) => (
            <button
              key={part}
              type="button"
              data-on={parts.includes(part) ? '' : undefined}
              title={ROLL_ABOUT[part]}
              aria-pressed={parts.includes(part)}
              onClick={() =>
                setParts((was) =>
                  was.includes(part)
                    ? was.filter((each) => each !== part)
                    : ROLL_PARTS.filter((each) => each === part || was.includes(each)),
                )
              }
            >
              {part}
            </button>
          ))}
        </span>
        <label className="seed">
          seed
          <input
            value={typed ?? scheme.seed ?? ''}
            placeholder="never rolled"
            spellCheck={false}
            aria-label="Roll seed"
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              const wanted = (typed ?? '').trim();
              if (wanted) roll(wanted);
            }}
          />
        </label>
        {before && (
          <Button
            onPress={() => {
              save(before);
              setBefore(null);
            }}
          >
            undo roll
          </Button>
        )}
        <span className="gap" />
        <span className="cap">
          {show.look ? `${scheme.looks[show.look]?.name ?? show.look} up` : 'nothing up'}
          {show.pinned ? ' · pinned' : ''}
          {show.colorway ? ` · ${show.colorway}` : ''}
        </span>
      </div>

      <div className="body">
        <section className="pane">
          <h4>the wheel</h4>
          <p className="cap flat">
            what plays when nobody has said otherwise. An empty pool means everything there
            is, so a rig you have not configured still turns through all of it.
          </p>
          <div className="fields">
            <label>
              <span>look every</span>
              <NumberField
                param={BARS}
                value={scheme.rotation.bars}
                onChange={(bars) => rotate({ bars })}
                name="bars"
              />
            </label>
            <label>
              <span>colour every</span>
              <NumberField
                param={BARS}
                value={scheme.rotation.colorEvery}
                onChange={(colorEvery) => rotate({ colorEvery })}
                name="bars"
              />
            </label>
            <label className="flat">
              <span>on a clip</span>
              <Toggle
                on={scheme.rotation.onClip}
                width={64}
                title="Also turn when somebody launches one clip on its own, out of band"
                onChange={(onClip) => rotate({ onClip })}
              >
                {scheme.rotation.onClip ? 'turns' : 'ignores'}
              </Toggle>
            </label>
            <label>
              <span>pace</span>
              <NumberField
                param={PACE}
                value={scheme.defaults.pace}
                onChange={(pace) => save({ ...scheme, defaults: { ...scheme.defaults, pace } })}
                name="rungs"
              />
            </label>
          </div>

          <h5>looks it turns through</h5>
          <Pool
            all={looks.map((each) => ({ id: each.id, name: each.def.name || each.id }))}
            chosen={scheme.rotation.looks}
            onChange={(next) => rotate({ looks: next })}
          />
          <h5>colourways it turns through</h5>
          <Pool
            all={ways.map((name) => ({ id: name, name }))}
            chosen={scheme.rotation.colorways}
            onChange={(next) => rotate({ colorways: next })}
          />
        </section>

        <section className="pane">
          <h4>songs that say otherwise</h4>
          <p className="cap flat">
            an override, not a requirement. Most songs should have nothing here — a song
            entry is how you say "not this one", and every one you add is a thing that
            stops turning.
          </p>
          {Object.keys(scheme.songs).length > 0 && (
            <div className="acts">
              <span className="cap">
                {/* "35 of 0 pinned" is what this said with no set connected,
                    which reads as a bug rather than as a missing bridge. */}
                {songs.length > 0
                  ? `${Object.keys(scheme.songs).length} of ${songs.length} pinned`
                  : `${Object.keys(scheme.songs).length} pinned, from a set not connected`}
              </span>
              {/* A scheme rolled before the wheel existed assigned a colourway to
                  every song, which is a perfectly good record of what you had and
                  also the state in which nothing turns. One button rather than
                  thirty-five dropdowns. */}
              <Button
                title="Let every song turn with the wheel again"
                onPress={() => save({ ...scheme, songs: {} })}
              >
                let them all turn
              </Button>
            </div>
          )}
          {songs.length === 0 && <p className="cap flat pad">no set connected</p>}
          <div className="songs">
            {songs.map((song) => {
              const spec = scheme.songs[song.name] ?? {};
              const pinned = spec.looks ?? [];
              return (
                <div
                  key={song.key}
                  className="song"
                  data-on={show.song === song.name ? '' : undefined}
                >
                  <span className="who" title={song.name}>
                    {song.name}
                  </span>
                  <Select
                    items={['turning', ...ways]}
                    index={Math.max(0, ways.indexOf(spec.colorway ?? '') + 1)}
                    onChange={(i) =>
                      save(setSong(scheme, song.name, { colorway: i === 0 ? undefined : ways[i - 1] }))
                    }
                    label={`${song.name} colourway`}
                    width={104}
                  />
                  <Select
                    items={['turning', ...looks.map((each) => each.def.name || each.id)]}
                    index={Math.max(
                      0,
                      looks.findIndex((each) => each.id === pinned[0]) + 1,
                    )}
                    onChange={(i) =>
                      save(
                        setSong(scheme, song.name, {
                          looks: i === 0 ? undefined : [looks[i - 1].id],
                        }),
                      )
                    }
                    label={`${song.name} look`}
                    width={132}
                  />
                </div>
              );
            })}
          </div>
        </section>

        <section className="pane">
          <Colorways scheme={scheme} save={save} current={show.colorway} />
        </section>
      </div>
    </div>
  );
}

/**
 * A pool, as chips you turn on and off.
 *
 * Empty means everything, and it says so rather than reading as "nothing is
 * selected, so nothing plays". That reading is the one thing a blank field must
 * not have here: it is the state a fresh install is in, and a fresh install has
 * to draw a show.
 */
function Pool({
  all,
  chosen,
  onChange,
}: {
  all: { id: string; name: string }[];
  chosen: readonly string[];
  onChange(next: string[]): void;
}) {
  return (
    <div className="parts pool">
      {all.map((each) => {
        const on = chosen.length === 0 || chosen.includes(each.id);
        return (
          <button
            key={each.id}
            type="button"
            data-on={on ? '' : undefined}
            data-all={chosen.length === 0 ? '' : undefined}
            aria-pressed={on}
            onClick={() => {
              // The first click on an "everything" pool has to mean "only this
              // one", not "all but this one" — turning a thing off when nothing
              // was chosen is how you say what you actually want.
              const from = chosen.length === 0 ? all.map((x) => x.id) : chosen;
              const next = toggleId(from, each.id, !from.includes(each.id));
              onChange(next.length === all.length ? [] : next);
            }}
          >
            {each.name}
          </button>
        );
      })}
      {chosen.length === 0 && <span className="cap flat">everything</span>}
    </div>
  );
}

/** One song's overrides, dropped entirely once it stops saying anything. */
function setSong(scheme: Scheme, name: string, next: Partial<Scheme['songs'][string]>): Scheme {
  const merged = { ...scheme.songs[name], ...next };
  for (const key of Object.keys(merged) as (keyof typeof merged)[]) {
    const value = merged[key];
    if (value === undefined || (Array.isArray(value) && value.length === 0)) delete merged[key];
  }
  const songs = { ...scheme.songs };
  // A song left behind after its last field was cleared would claim a decision
  // nobody made, and would keep the wheel from ever reaching it again.
  if (Object.keys(merged).length === 0) delete songs[name];
  else songs[name] = merged;
  return { ...scheme, songs };
}
