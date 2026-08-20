import { useRef, useState } from 'react';
import type { Scheme, SetGrid, Show } from '../../protocol.ts';
import { BLENDS } from '../../protocol.ts';
import { resolveLayer } from '../../resolve.ts';
import { Button } from '../../../widgets/src/controls/Button.tsx';
import { Knob } from '../../../widgets/src/controls/Knob.tsx';
import { Segmented } from '../../../widgets/src/controls/Segmented.tsx';
import { Select } from '../../../widgets/src/controls/Select.tsx';
import { Toggle } from '../../../widgets/src/controls/Toggle.tsx';
import type { Aim } from './Console.tsx';
import { LookPicks } from './LookPicks.tsx';
import { BIAS, ENERGY, FLOOR, PERCENT } from './param.ts';
import {
  describe,
  reachOf,
  SCOPES,
  stage as stageEdit,
  valueAt,
  type Edit,
  type Scope,
} from './pending.ts';
import { keyFor } from './Console.tsx';
import { Stage } from './Stage.tsx';
import type { Clock } from '../state/useShow.ts';

/**
 * The picture first, and the controls beside it.
 *
 * Every other arrangement of this screen was wrong for the same reason: you are
 * not setting a value, you are judging a picture, and a form with a small
 * preview in the corner makes you do the judging in the corner. So the output
 * is the screen and the inspector is what fits next to it.
 *
 * ## Nothing lands until it has been seen next to what it replaces
 *
 * The two panels are the same show on the same clock against two schemes — the
 * one that is live and the one your staged edits would make. That is the whole
 * mechanism, and it is why edits are values rather than mutations: a mutation
 * would have already destroyed the thing you needed to compare against.
 *
 * The comparison is only honest if both sides are the **same instant**. Two
 * reactive pictures sampled a second apart differ because the music moved, and
 * you would read that as your edit. Hence one clock, and hence `hold` and
 * `loop`, which are the two ways to stop the music being the variable.
 */
/** The three ways to look at two pictures, and what they are called on screen. */
const MODES = ['side', 'wipe', 'toggle'] as const;
const MODE_LABELS = ['side by side', 'wipe', 'toggle'];

export function Bind({
  show,
  showRef,
  scheme,
  proposed,
  grid,
  clock,
  aim,
  onAim,
  edits,
  setEdits,
  onLand,
  onDiscard,
  onLook,
}: {
  show: Show;
  showRef: { readonly current: Show };
  scheme: Scheme;
  proposed: Scheme;
  grid: SetGrid | null;
  clock: Clock;
  aim: Aim;
  onAim(next: Aim): void;
  edits: Edit[];
  setEdits(next: Edit[]): void;
  onLand(): void;
  onDiscard(): void;
  onLook(id: string): void;
}) {
  const [mode, setMode] = useState<'side' | 'wipe' | 'toggle'>('side');
  const [scope, setScope] = useState<Scope>('track');
  const [held, setHeld] = useState(false);
  const [looping, setLooping] = useState(false);
  const [wipe, setWipe] = useState(0.5);
  const [showing, setShowing] = useState<'on' | 'proposed'>('proposed');

  // Where the loop started, captured once so the four bars stay the same four
  // bars rather than sliding forward every render.
  const loopFrom = useRef(0);
  if (looping && loopFrom.current === 0) loopFrom.current = clock.beat();
  if (!looping && loopFrom.current !== 0) loopFrom.current = 0;

  const bars = show.quantum * 4;
  const warp = looping
    ? (beat: number) => loopFrom.current + (((beat - loopFrom.current) % bars) + bars) % bars
    : undefined;

  const key = keyFor(aim, scope);
  const mine = edits.filter((e) => e.scope === scope && e.key === key);
  const trackIndex = aim.track?.t ?? null;
  const reach = key ? reachOf(scope, key, grid, trackIndex) : null;

  const put = (field: Edit['field'], to: Edit['to']) => {
    if (!key) return;
    setEdits(stageEdit(edits, { scope, key, field, to }));
  };

  return (
    <div className="bind">
      <div className="main">
        <div className="pair" data-mode={mode}>
          <figure className="on" data-hidden={mode === 'toggle' && showing !== 'on' ? '' : undefined}>
            <Stage
              showRef={showRef}
              scheme={scheme}
              clock={clock}
              frozen={held}
              warp={warp}
              className="shot"
            />
            <figcaption>on screen</figcaption>
          </figure>
          <figure
            className="proposed"
            data-hidden={mode === 'toggle' && showing !== 'proposed' ? '' : undefined}
            style={mode === 'wipe' ? ({ '--wipe': `${wipe * 100}%` } as React.CSSProperties) : undefined}
          >
            <Stage
              showRef={showRef}
              scheme={proposed}
              clock={clock}
              frozen={held}
              warp={warp}
              className="shot"
            />
            <figcaption>proposed{edits.length === 0 ? ' — nothing staged' : ''}</figcaption>
          </figure>
          {mode === 'wipe' && (
            <input
              className="wiper"
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={wipe}
              aria-label="Wipe between on screen and proposed"
              onChange={(e) => setWipe(Number(e.target.value))}
            />
          )}
        </div>

        <div className="ab">
          <span className="cap">same instant</span>
          <Segmented
            items={MODE_LABELS}
            index={MODES.indexOf(mode)}
            onChange={(i) => setMode(MODES[i])}
            label="How to compare"
          />
          {mode === 'toggle' && (
            <Button onPress={() => setShowing((s) => (s === 'on' ? 'proposed' : 'on'))}>
              showing {showing === 'on' ? 'on screen' : 'proposed'}
            </Button>
          )}
          <span className="gap" />
          <Toggle on={held} onChange={setHeld} width={64}>
            hold clock
          </Toggle>
          <Toggle on={looping} onChange={setLooping} width={72}>
            loop 4 bars
          </Toggle>
        </div>

        <div className="stack">
          {show.layers.map((layer) => (
            <button
              key={layer.t}
              type="button"
              className="chip"
              data-on={aim.track?.t === layer.t ? '' : undefined}
              data-silent={layer.playing < 0 ? '' : undefined}
              onClick={() =>
                onAim({
                  ...aim,
                  track: { t: layer.t, name: layer.name },
                  clip: layer.clipName || null,
                })
              }
            >
              {layer.name}
            </button>
          ))}
          {show.layers.length === 0 && <span className="cap">the set has no tracks yet</span>}
        </div>
        <p className="cap under">layer stack, bottom to top · click one to aim the edit at it</p>
      </div>

      <aside className="edit">
        <section className="reach">
          <h4>how far does this reach</h4>
          <Segmented
            items={SCOPES as unknown as string[]}
            index={SCOPES.indexOf(scope)}
            onChange={(i) => setScope(SCOPES[i])}
            label="How far this reaches"
            className="wide"
          />
          {reach ? (
            <p className="lands">
              lands on <b>{reach.lands}</b>
              <br />
              {reach.songs} song{reach.songs === 1 ? '' : 's'} · {reach.sections} section
              {reach.sections === 1 ? '' : 's'} · {reach.clips} clip
              {reach.clips === 1 ? '' : 's'}
            </p>
          ) : (
            <p className="lands bad">nothing to aim at — pick a layer</p>
          )}
        </section>

        <section className="change">
          <h4>the change</h4>
          {mine.length === 0 && <p className="cap">nothing staged at this level</p>}
          {mine.map((edit) => {
            const { was, becomes } = describe(scheme, edit);
            return (
              <p key={edit.field} className="delta">
                <span className="was">{was}</span> ▸ <b>{becomes}</b>
                <Button
                  tone="quiet"
                  label={`Unstage ${edit.field}`}
                  onPress={() => setEdits(edits.filter((e) => e !== edit))}
                >
                  ×
                </Button>
              </p>
            );
          })}

          {key && <Fields scheme={scheme} proposed={proposed} scope={scope} name={key} put={put} />}
        </section>

        <Inherited scheme={proposed} show={show} aim={aim} scope={scope} grid={grid} onLook={onLook} />

        <div className="acts">
          <Button className="go" disabled={edits.length === 0} onPress={onLand}>
            land it
          </Button>
          <Button disabled={edits.length === 0} onPress={onDiscard}>
            discard
          </Button>
          <span className="gap" />
          {edits.length > 0 && <span className="cap">{edits.length} pending</span>}
        </div>
        <p className="cap under">nothing is committed until it has been seen next to what it replaces</p>
      </aside>
    </div>
  );
}

/** The fields a level is in a position to decide, and nothing it is not. */
function Fields({
  scheme,
  proposed,
  scope,
  name,
  put,
}: {
  scheme: Scheme;
  proposed: Scheme;
  scope: Scope;
  name: string;
  put(field: Edit['field'], to: Edit['to']): void;
}) {
  const at = (field: Parameters<typeof valueAt>[3]) => valueAt(proposed, scope, name, field);

  if (scope === 'song') {
    const ways = Object.keys(scheme.colorways);
    const colorway = (at('colorway') as string) ?? '';
    return (
      <div className="fields">
        <label>
          <span>colourway</span>
          <Select
            items={['—', ...ways]}
            index={Math.max(0, ways.indexOf(colorway) + 1)}
            onChange={(i) => put('colorway', i === 0 ? undefined : ways[i - 1])}
            label="Colourway"
            width={120}
          />
        </label>
        <label>
          <span>drive</span>
          <Knob
            param={BIAS}
            value={PERCENT.to((at('bias') as number) ?? 0)}
            onChange={(v) => put('bias', PERCENT.from(v))}
            name=""
          />
        </label>
      </div>
    );
  }

  if (scope === 'section') {
    return (
      <div className="fields">
        <label>
          <span>energy</span>
          <Knob
            param={ENERGY}
            value={PERCENT.to((at('energy') as number) ?? scheme.defaults.energy)}
            onChange={(v) => put('energy', PERCENT.from(v))}
            name=""
          />
        </label>
        <div className="wide">
          <span className="cap">character</span>
          <LookPicks
            scheme={scheme}
            chosen={at('looks') as string[] | undefined}
            onChange={(next: string[]) => put('looks', next)}
          />
        </div>
      </div>
    );
  }

  const blend = (at('blend') as string) ?? '';
  return (
    <div className="fields">
      <label>
        <span>blend</span>
        <Select
          items={['—', ...BLENDS]}
          index={Math.max(0, BLENDS.indexOf(blend as never) + 1)}
          onChange={(i) => put('blend', i === 0 ? undefined : BLENDS[i - 1])}
          label="Blend"
          width={92}
        />
      </label>
      <label>
        <span>bias</span>
        <Knob
          param={BIAS}
          value={PERCENT.to((at('bias') as number) ?? 0)}
          onChange={(v) => put('bias', PERCENT.from(v))}
          name=""
        />
      </label>
      <label>
        <span>floor</span>
        <Knob
          param={FLOOR}
          value={PERCENT.to((at('floor') as number) ?? 0)}
          onChange={(v) => put('floor', PERCENT.from(v))}
          name=""
        />
      </label>
      <label className="flat">
        <span>hide</span>
        <Toggle on={Boolean(at('hide'))} width={40} onChange={(on) => put('hide', on || undefined)}>
          hide
        </Toggle>
      </label>
      <div className="wide">
        <span className="cap">the stack — a generator sets the base, the rest add</span>
        <LookPicks
          scheme={scheme}
          chosen={at('looks') as string[] | undefined}
          onChange={(next: string[]) => put('looks', next)}
        />
      </div>
    </div>
  );
}

/**
 * What the other levels are still saying, which the edit is not touching.
 *
 * Half of understanding a change is knowing what it *leaves alone*. A panel
 * showing only what you are altering makes every edit look total, and the
 * cascade's whole point is that it is not — the song keeps supplying the
 * colours while you change what the track draws.
 */
function Inherited({
  scheme,
  show,
  aim,
  scope,
  grid,
  onLook,
}: {
  scheme: Scheme;
  show: Show;
  aim: Aim;
  scope: Scope;
  grid: SetGrid | null;
  onLook(id: string): void;
}) {
  if (!aim.track) return null;
  const depth = Math.max(0, (grid?.tracks ?? []).findIndex((t) => t.t === aim.track!.t));
  const role = aim.section;
  const r = resolveLayer(scheme, {
    name: aim.track.name,
    depth,
    count: grid?.tracks.length ?? show.layers.length ?? 1,
    section: role ? scheme.archetypes[role]?.looks : undefined,
    clip: aim.clip,
  });
  const colorway = aim.song ? scheme.songs[aim.song]?.colorway : undefined;
  const energy = role ? scheme.archetypes[role]?.energy : undefined;
  const live = r.offers.filter((id) => scheme.looks[id]);

  // Only the levels this edit is not the one deciding, which is what makes the
  // list mean "untouched" rather than "everything".
  const lines: { what: string; from: string; is: string }[] = [];
  if (scope !== 'song' && colorway) {
    lines.push({ what: 'colour', from: `song · ${aim.song}`, is: colorway });
  }
  if (scope !== 'section' && role && energy !== undefined) {
    lines.push({ what: 'energy', from: `[${role}]`, is: energy.toFixed(2) });
  }
  const baseName = scheme.looks[r.base]?.name ?? r.base;
  if (scope !== 'track' && r.said.base === 'track') {
    lines.push({ what: 'base', from: `track · ${aim.track.name}`, is: baseName });
  }
  if (r.said.base === 'hint') {
    lines.push({ what: 'base', from: 'name hint', is: baseName });
  }

  return (
    <section className="inherited">
      <h4>inherited, untouched</h4>
      {lines.length === 0 && <p className="cap">nothing above this level has said anything</p>}
      {lines.map((line) => (
        <p key={line.what + line.from}>
          {line.what} ← {line.from} · <b>{line.is}</b>
        </p>
      ))}
      {live.length > 0 && (
        <p className="fx">
          {live.map((id) => (
            <Button key={id} tone="quiet" className="link" onPress={() => onLook(id)}>
              {scheme.looks[id]?.name || id}
            </Button>
          ))}
        </p>
      )}
    </section>
  );
}
