import { useState } from 'react';
import type { GridRow, Scheme, SetGrid, Show } from '../../protocol.ts';
import { resolveLayer } from '../../resolve.ts';
import { newSeed, rollScheme } from '../../roll.ts';
import { cellForColumn, columnsOf, passes, usesOf, type Column, type Cut, type Filter } from './coverage.ts';
import type { Aim } from './Console.tsx';
import { Colorways } from './Colorways.tsx';
import { Knob } from '../../../widgets/src/controls/Knob.tsx';
import { ENERGY, MAX_EFFECTS, PACE, PERCENT } from './param.ts';
import { Preview } from './Preview.tsx';
import type { Clock } from '../state/useShow.ts';

/**
 * The set, all of it, and what has not been decided about.
 *
 * The view exists because of an asymmetry in how this gets configured: you
 * author one song at a time, and the failure is set-wide. A track nobody bound
 * draws whatever its name suggested, which is *fine* almost everywhere — that is
 * the point of the backstop — right up until the one song where it reads wrong,
 * and there is no way to find that song by playing them one at a time.
 *
 * So the interesting colour here is the pale one. A matrix that showed how much
 * was configured would be a progress bar; this shows what is left, which is a
 * to-do list you can work through the night before a gig.
 *
 * **Rows and columns are both cuts of the same question.** Songs against tracks
 * finds the song nobody styled; sections against tracks finds the track
 * configured for the verses and forgotten for the choruses. Neither is the
 * primary one and the toolbar refuses to imply that either is.
 */
export function Coverage({
  show,
  scheme,
  grid,
  save,
  clock,
  aim,
  onAim,
  onOpen,
  onLook,
}: {
  show: Show;
  scheme: Scheme;
  grid: SetGrid | null;
  save(next: Scheme): void;
  clock: Clock;
  aim: Aim;
  onAim(next: Aim): void;
  onOpen(next: Aim): void;
  onLook(id: string): void;
}) {
  const [rows, setRows] = useState<'songs' | 'sections'>('songs');
  const [cut, setCut] = useState<Cut>('tracks');
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState<string | null>(null);
  /**
   * The scheme as it was before the last roll, and one level is the right
   * number. A roll replaces everything, so the thing you want back is always
   * the thing you had a moment ago — and for anything older the seed is a
   * better answer than a stack, because it survives a reload.
   */
  const [before, setBefore] = useState<Scheme | null>(null);

  const roll = (seed: string) => {
    setBefore(scheme);
    setTyped(null);
    save(rollScheme(seed, show, scheme));
  };

  if (!grid) {
    return (
      <div className="coverage empty">
        <p>{show.connected ? 'reading the set…' : 'waiting for the bridge'}</p>
      </div>
    );
  }

  const list = rows === 'songs' ? grid.songs : grid.sections;
  const columns = columnsOf(grid, cut);

  const selected = pick(list, aim, rows);
  const column = columns.find((c) => c.tracks.some((t) => t.name === aim.track?.name)) ?? null;

  return (
    <div className="coverage">
      <div className="bar">
        <span className="cap">rows</span>
        <Seg<'songs' | 'sections'> value={rows} set={setRows} of={['songs', 'sections']} />
        <span className="cap">cols</span>
        <Seg<Cut> value={cut} set={setCut} of={['tracks', 'groups']} />
        <span className="gap" />
        <Seg<Filter> value={filter} set={setFilter} of={['all', 'gaps', 'bound']} />
        <button
          type="button"
          className="roll"
          title="Deal the whole set a new identity from a fresh seed"
          onClick={() => roll(newSeed())}
        >
          roll
        </button>
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
          <button
            type="button"
            onClick={() => {
              save(before);
              setBefore(null);
            }}
          >
            undo roll
          </button>
        )}
      </div>

      <div className="body">
        <div className="matrix" style={{ '--cols': columns.length } as React.CSSProperties}>
          <div className="head">
            <span className="corner" />
            {columns.map((c) => (
              <span key={c.key} className="col" title={c.tracks.map((t) => t.name).join(', ')}>
                <b>{c.label}</b>
              </span>
            ))}
          </div>

          {list.map((row) => {
            const cells = columns.map((c) => cellForColumn(scheme, row, c));
            const shown = cells.filter((cell) => passes(cell, filter));
            if (filter !== 'all' && shown.length === 0) return null;
            // A row with nothing said anywhere is the one worth finding, and it
            // is invisible cell by cell — every square is merely pale.
            const untouched =
              cells.some((cell) => cell.answer !== 'absent') &&
              cells.every((cell) => cell.answer === 'backstop' || cell.answer === 'absent');
            return (
              <div key={row.key} className="row" data-untouched={untouched ? '' : undefined}>
                <button
                  type="button"
                  className="label"
                  data-on={selected?.key === row.key ? '' : undefined}
                  onClick={() => onAim(aimAt(row, rows, null))}
                  title={row.bpm ? `${row.bpm} · ${row.tonality}` : `${row.roles.length} scenes`}
                >
                  {row.name}
                </button>
                {columns.map((c, i) => {
                  const cell = cells[i];
                  const dim = !passes(cell, filter);
                  const on = selected?.key === row.key && column?.key === c.key;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      className="cell"
                      data-answer={cell.answer}
                      data-dim={dim ? '' : undefined}
                      data-on={on ? '' : undefined}
                      disabled={cell.answer === 'absent'}
                      aria-label={`${row.name} · ${c.label} · ${cell.answer}`}
                      title={`${row.name} · ${c.label} — ${cell.answer}${
                        cell.clips.length ? ` · ${cell.clips.join(', ')}` : ''
                      }`}
                      onClick={() => onAim(aimAt(row, rows, c))}
                      onDoubleClick={() => onOpen(aimAt(row, rows, c))}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>

        <Inspect
          scheme={scheme}
          save={save}
          grid={grid}
          show={show}
          clock={clock}
          row={selected}
          column={column}
          rows={rows}
          onOpen={() => selected && onOpen(aimAt(selected, rows, column))}
          onLook={onLook}
          error={error}
          setError={setError}
        />
      </div>

      <div className="legend">
        <span data-answer="said" /> said here
        <span data-answer="inherited" /> inherited
        <span data-answer="backstop" /> backstop
        <span data-answer="absent" /> not in this row
      </div>
    </div>
  );
}

function Seg<T extends string>({
  value,
  set,
  of,
}: {
  value: T;
  set(next: T): void;
  of: readonly T[];
}) {
  return (
    <span className="seg">
      {of.map((name) => (
        <button
          key={name}
          type="button"
          data-on={name === value ? '' : undefined}
          onClick={() => set(name)}
        >
          {name}
        </button>
      ))}
    </span>
  );
}

function pick(list: GridRow[], aim: Aim, rows: 'songs' | 'sections'): GridRow | null {
  const want = rows === 'songs' ? aim.song : aim.section;
  if (!want) return list[0] ?? null;
  return list.find((r) => r.key === want || r.name === want) ?? list[0] ?? null;
}

function aimAt(row: GridRow, rows: 'songs' | 'sections', column: Column | null): Aim {
  const track = column?.tracks[0] ?? null;
  return {
    song: rows === 'songs' ? row.name : null,
    section: rows === 'sections' ? row.key : (row.roles[0] ?? null),
    track,
    // The exception is made from a clip the row actually holds, which is the
    // only kind there is: a clip name that is not in this song cannot be the
    // thing you just noticed.
    clip: track ? (row.clips[track.t]?.[0] ?? null) : null,
  };
}

/**
 * One cell, read out.
 *
 * The sentence that matters is **where the answer came from**, because that is
 * what tells you where to go and change it. A panel that only said what the
 * layer looks like would leave you hunting for the level that decided it, which
 * is the hunt this whole view exists to end.
 */
function Inspect({
  scheme,
  save,
  grid,
  show,
  clock,
  row,
  column,
  rows,
  onOpen,
  onLook,
  error,
  setError,
}: {
  scheme: Scheme;
  save(next: Scheme): void;
  grid: SetGrid;
  show: Show;
  clock: Clock;
  row: GridRow | null;
  column: Column | null;
  rows: 'songs' | 'sections';
  onOpen(): void;
  onLook(id: string): void;
  error: string | null;
  setError(next: string | null): void;
}) {
  if (!row) return <aside className="inspect empty">the set has no songs yet</aside>;
  if (!column) {
    return (
      <aside className="inspect">
        <h3>{row.name}</h3>
        <dl>
          {row.bpm && (
            <>
              <dt>bpm</dt>
              <dd>{row.bpm}</dd>
              <dt>key</dt>
              <dd>{row.tonality || '—'}</dd>
            </>
          )}
          <dt>sections</dt>
          <dd>{row.roles.join(' · ') || '—'}</dd>
          <dt>tracks used</dt>
          <dd>{Object.keys(row.clips).length}</dd>
          <dt>colourway</dt>
          <dd>{scheme.songs[row.key]?.colorway ?? scheme.defaults.colorway}</dd>
        </dl>
        <p className="hint">pick a cell to see what draws it</p>
        <h4>colourways</h4>
        <Colorways scheme={scheme} save={save} current={show.colorway} />

        <h4>the whole set</h4>
        <div className="knobs">
          <Knob
            param={ENERGY}
            value={PERCENT.to(scheme.defaults.energy)}
            onChange={(v) =>
              save({ ...scheme, defaults: { ...scheme.defaults, energy: PERCENT.from(v) } })
            }
            name="energy"
          />
          <Knob
            param={MAX_EFFECTS}
            value={scheme.defaults.maxEffects}
            onChange={(v) =>
              save({ ...scheme, defaults: { ...scheme.defaults, maxEffects: Math.round(v) } })
            }
            name="max fx"
          />
          <Knob
            param={PACE}
            value={scheme.defaults.pace}
            onChange={(v) =>
              save({ ...scheme, defaults: { ...scheme.defaults, pace: Math.round(v) } })
            }
            name="pace"
          />
        </div>
        <p className="cap flat">
          the energy a section falls back to, how many effects a layer may carry, and how far
          along the ladder of musical divisions the whole show reacts.
        </p>
      </aside>
    );
  }

  const track = column.tracks[0];
  const depth = grid.tracks.findIndex((t) => t.t === track.t);
  const role = rows === 'sections' ? row.key : (row.roles[0] ?? null);
  const clip = row.clips[track.t]?.[0] ?? null;
  const r = resolveLayer(scheme, {
    name: track.name,
    depth: Math.max(0, depth),
    count: grid.tracks.length,
    section: role ? scheme.archetypes[role]?.effects : undefined,
    clip,
  });
  const live = r.offers.filter((id) => scheme.effects[id]);
  const first = live[0] ? scheme.effects[live[0]] : null;
  const uses = live[0] ? usesOf(scheme, grid, live[0]) : null;
  const energy = clamp01((scheme.archetypes[role ?? '']?.energy ?? scheme.defaults.energy) + r.bias);
  const colors = scheme.colorways[scheme.songs[row.key]?.colorway ?? scheme.defaults.colorway] ??
    scheme.colorways[scheme.defaults.colorway] ?? ['#ffffff'];

  return (
    <aside className="inspect">
      <h3>
        {row.name} · {track.name}
      </h3>
      <Preview
        def={first}
        source={r.source}
        amount={0.8}
        energy={energy}
        color={pack(colors[Math.max(0, depth) % colors.length])}
        pace={scheme.defaults.pace}
        quantum={show.quantum}
        clock={clock}
        onError={setError}
      />
      {error && <p className="bad">{error}</p>}
      <dl>
        <dt>source</dt>
        <dd>
          {r.source} <em>{r.said.source}</em>
        </dd>
        <dt>effects</dt>
        <dd>{live.map((id) => scheme.effects[id]?.name || id).join(' + ') || '—'}</dd>
        <dt>blend</dt>
        <dd>
          {r.blend} <em>{r.said.blend}</em>
        </dd>
        <dt>energy</dt>
        <dd>{Math.round(energy * 100)}</dd>
      </dl>

      {uses && live[0] && (uses.layers.length > 1 || uses.songs.length > 1) && (
        <div className="also">
          <h4>also uses {scheme.effects[live[0]]?.name}</h4>
          <p>
            {uses.layers.length} layer{uses.layers.length === 1 ? '' : 's'} · {uses.songs.length}{' '}
            song{uses.songs.length === 1 ? '' : 's'}
          </p>
        </div>
      )}

      <div className="acts">
        <button type="button" className="go" onClick={onOpen}>
          open in bind ▸
        </button>
        {live[0] && (
          <button type="button" onClick={() => onLook(live[0])}>
            edit the look ▸
          </button>
        )}
      </div>
    </aside>
  );
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function pack(text: string): number {
  const clean = (text ?? '#ffffff').trim().replace(/^#/, '');
  const full = clean.length === 3 ? clean.replace(/./g, '$&$&') : clean;
  const value = Number.parseInt(full, 16);
  return Number.isFinite(value) ? value & 0xffffff : 0xffffff;
}
