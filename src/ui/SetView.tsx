import { useState } from 'react';
import type { Scheme, SetGrid, Show } from '../../protocol.ts';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { NumberField } from '@openflow/widgets/controls/NumberField.tsx';
import { Select } from '@openflow/widgets/controls/Select.tsx';
import { Toggle } from '@openflow/widgets/controls/Toggle.tsx';
import { Colorways } from './Colorways.tsx';
import { flowList, toggleId } from './edits.ts';
import { newSeed, RANDOM_ABOUT, RANDOM_PARTS, randomizeScheme, type RandomPart } from '../../randomize.ts';
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
 * and which flows. Everything else is the **wheel**: a rig with nothing
 * configured turns through everything you have made, which is what makes it
 * something you can point at a set you have never seen.
 */
export function SetView({
  show,
  scheme,
  grid,
  edit,
}: {
  show: Show;
  scheme: Scheme;
  grid: SetGrid | null;
  edit(next: Scheme): void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const [parts, setParts] = useState<RandomPart[]>([...RANDOM_PARTS]);
  /**
   * The scheme as it was before the last randomise, and one level is the right
   * number. A randomise replaces a library, so the thing you want back is always
   * the thing you had a moment ago — and for anything older the seed is a better
   * answer than a stack, because it survives a reload.
   */
  const [before, setBefore] = useState<Scheme | null>(null);

  const flows = flowList(scheme);
  const ways = Object.keys(scheme.colorways);
  const songs = grid?.songs ?? show.songs.map((name) => ({ name, key: name, roles: [] }));

  const randomize = (seed: string) => {
    if (parts.length === 0) return;
    setBefore(scheme);
    setTyped(null);
    edit(randomizeScheme(seed, show, scheme, parts));
  };

  const rotate = (next: Partial<Scheme['rotation']>) =>
    edit({ ...scheme, rotation: { ...scheme.rotation, ...next } });

  return (
    <div className="setview wdg">
      <div className="bar">
        <Button
          title={
            parts.length === RANDOM_PARTS.length
              ? 'Deal a whole new library from a fresh seed'
              : `Deal ${parts.join(', ')} and leave the rest alone`
          }
          disabled={parts.length === 0}
          onPress={() => randomize(newSeed())}
        >
          randomize
        </Button>
        <span className="parts">
          {RANDOM_PARTS.map((part) => (
            <button
              key={part}
              type="button"
              data-on={parts.includes(part) ? '' : undefined}
              title={RANDOM_ABOUT[part]}
              aria-pressed={parts.includes(part)}
              onClick={() =>
                setParts((was) =>
                  was.includes(part)
                    ? was.filter((each) => each !== part)
                    : RANDOM_PARTS.filter((each) => each === part || was.includes(each)),
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
            placeholder="never randomised"
            spellCheck={false}
            aria-label="Randomise seed"
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              const wanted = (typed ?? '').trim();
              if (wanted) randomize(wanted);
            }}
          />
        </label>
        {before && (
          <Button
            onPress={() => {
              edit(before);
              setBefore(null);
            }}
          >
            undo randomize
          </Button>
        )}
        <span className="gap" />
        <span className="cap">
          {show.flow ? `${scheme.flows[show.flow]?.name ?? show.flow} up` : 'nothing up'}
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
              <span>flow every</span>
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
                onChange={(pace) => edit({ ...scheme, defaults: { ...scheme.defaults, pace } })}
                name="rungs"
              />
            </label>
          </div>

          <h5>flows it turns through</h5>
          <Pool
            all={flows.map((each) => ({ id: each.id, name: each.def.name || each.id }))}
            chosen={scheme.rotation.flows}
            onChange={(next) => rotate({ flows: next })}
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
              {/* A scheme randomised before the wheel existed assigned a colourway to
                  every song, which is a perfectly good record of what you had and
                  also the state in which nothing turns. One button rather than
                  thirty-five dropdowns. */}
              <Button
                title="Let every song turn with the wheel again"
                onPress={() => edit({ ...scheme, songs: {} })}
              >
                let them all turn
              </Button>
            </div>
          )}
          {songs.length === 0 && <p className="cap flat pad">no set connected</p>}
          <div className="songs">
            {songs.map((song) => {
              const spec = scheme.songs[song.name] ?? {};
              const pinned = spec.flows ?? [];
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
                      edit(setSong(scheme, song.name, { colorway: i === 0 ? undefined : ways[i - 1] }))
                    }
                    label={`${song.name} colourway`}
                    width={104}
                  />
                  <Select
                    items={['turning', ...flows.map((each) => each.def.name || each.id)]}
                    index={Math.max(
                      0,
                      flows.findIndex((each) => each.id === pinned[0]) + 1,
                    )}
                    onChange={(i) =>
                      edit(
                        setSong(scheme, song.name, {
                          flows: i === 0 ? undefined : [flows[i - 1].id],
                        }),
                      )
                    }
                    label={`${song.name} flow`}
                    width={132}
                  />
                </div>
              );
            })}
          </div>
        </section>

        <section className="pane">
          <Colorways scheme={scheme} edit={edit} current={show.colorway} />
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
