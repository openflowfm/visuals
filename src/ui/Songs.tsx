import { useState } from 'react';
import type { Scheme, Show, SongSpec } from '../../protocol.ts';
import { Knob } from '../../../widgets/src/controls/Knob.tsx';
import { Select } from '../../../widgets/src/controls/Select.tsx';
import { Row } from '../../../widgets/src/chrome/Row.tsx';
import { BIAS, PERCENT } from './param.ts';

/**
 * Songs: colour, and how hard this one plays.
 *
 * Both of the things a song owns are here, and the second is what makes the
 * archetypes honest. "The same chorus should differ between two songs" was true
 * of the design and false of the code until a song could say so — an archetype
 * describes what a chorus *is*, and this says how hard this song plays one.
 *
 * The list is the set's, every song of it, whether or not anything has been
 * assigned. A set with thirty-five songs and three assignments used to look
 * identical to a set with three songs, which is exactly the thing you want to
 * see before a show rather than during one.
 */
export function Songs({
  show,
  scheme,
  patch,
}: {
  show: Show;
  scheme: Scheme;
  patch(next: Partial<Scheme>): void;
}) {
  const [filter, setFilter] = useState('');
  const names = [...new Set([...show.songs, ...Object.keys(scheme.songs)])].sort();
  const needle = filter.trim().toLowerCase();
  const shown = needle ? names.filter((n) => n.toLowerCase().includes(needle)) : names;

  const ways = Object.keys(scheme.colorways);
  const assigned = names.filter((name) => scheme.songs[name]?.colorway).length;

  const setSong = (name: string, next: Partial<SongSpec>) => {
    const merged: SongSpec = { ...scheme.songs[name], ...next };
    if (merged.bias === 0) delete merged.bias;
    const songs = { ...scheme.songs };
    if (Object.keys(merged).length === 0) delete songs[name];
    else songs[name] = merged;
    patch({ songs });
  };

  /**
   * Renaming a colourway carries every reference with it.
   *
   * A rename that silently unstyled half the set would be worse than not being
   * able to rename at all — and it would do it quietly, since an unassigned song
   * falls back rather than going dark.
   */
  const renameWay = (from: string, to: string) => {
    const name = to.trim();
    if (!name || name === from || scheme.colorways[name]) return;
    const colorways: Record<string, string[]> = {};
    for (const [key, colors] of Object.entries(scheme.colorways)) {
      colorways[key === from ? name : key] = colors;
    }
    const songs = Object.fromEntries(
      Object.entries(scheme.songs).map(([song, spec]) => [
        song,
        spec.colorway === from ? { ...spec, colorway: name } : spec,
      ]),
    );
    const defaults =
      scheme.defaults.colorway === from ? { ...scheme.defaults, colorway: name } : scheme.defaults;
    patch({ colorways, songs, defaults });
  };

  const setWay = (name: string, colors: string[] | null) => {
    const colorways = { ...scheme.colorways };
    if (colors === null) delete colorways[name];
    else colorways[name] = colors;
    patch({ colorways });
  };

  return (
    <>
      <section>
        <h3>
          songs
          <em>
            {assigned} of {names.length} assigned
          </em>
        </h3>

        {names.length > 8 && (
          <input
            className="field"
            value={filter}
            placeholder="find a song"
            spellCheck={false}
            aria-label="Filter songs"
            onChange={(e) => setFilter(e.target.value)}
          />
        )}

        <div className="songs">
          {shown.map((name) => {
            const spec = scheme.songs[name];
            const way = spec?.colorway;
            return (
              <div key={name} className="song" data-on={name === show.song ? '' : undefined}>
                <span className="songname" title={name}>
                  {name}
                </span>
                <Select
                  items={['—', ...ways]}
                  index={way && ways.includes(way) ? ways.indexOf(way) + 1 : 0}
                  width={92}
                  label={`${name} colourway`}
                  onChange={(i) =>
                    setSong(name, {
                      colorway: i === 0 ? undefined : ways[i - 1],
                    })
                  }
                />
                <span className="swatch" aria-hidden="true">
                  {(scheme.colorways[way ?? scheme.defaults.colorway] ?? []).map((hex, i) => (
                    <i key={i} style={{ background: hex }} />
                  ))}
                </span>
                <Knob
                  param={BIAS}
                  value={PERCENT.to(spec?.bias ?? 0)}
                  onChange={(v) => setSong(name, { bias: PERCENT.from(v) })}
                  name="Bias"
                />
              </div>
            );
          })}
          {names.length === 0 && (
            <p className="note">
              The set names no songs yet. A song is a run of scenes the bridge groups by name — see
              the wiki on how a set is read.
            </p>
          )}
        </div>
        <p className="note">
          A layer takes its colour from the song's colourway by depth in the stack. Clip colour is
          deliberately not an input — that is navigation, and it stays yours. An unassigned song
          falls back rather than going dark.
        </p>
      </section>

      <section>
        <h3>
          colourways
          <em>{ways.length}</em>
        </h3>
        <div className="ways">
          {ways.map((name) => (
            <div key={name} className="way" data-on={name === show.colorway ? '' : undefined}>
              <input
                className="wayname"
                defaultValue={name}
                key={`${name}-name`}
                spellCheck={false}
                aria-label={`${name} name`}
                onBlur={(e) => renameWay(name, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
              />
              {scheme.colorways[name].map((hex, i) => (
                <input
                  key={i}
                  type="color"
                  value={hex}
                  aria-label={`${name} colour ${i + 1}`}
                  onChange={(e) => {
                    const colors = [...scheme.colorways[name]];
                    colors[i] = e.target.value;
                    setWay(name, colors);
                  }}
                />
              ))}
              <button
                type="button"
                className="tick"
                aria-label={`Add a colour to ${name}`}
                onClick={() => setWay(name, [...scheme.colorways[name], '#ffffff'])}
              >
                +
              </button>
              <button
                type="button"
                className="tick"
                aria-label={`Remove the last colour from ${name}`}
                disabled={scheme.colorways[name].length <= 1}
                onClick={() => setWay(name, scheme.colorways[name].slice(0, -1))}
              >
                −
              </button>
              <button
                type="button"
                className="drop"
                aria-label={`Delete ${name}`}
                disabled={ways.length <= 1 || name === scheme.defaults.colorway}
                title={
                  name === scheme.defaults.colorway
                    ? 'the fallback colourway cannot be deleted'
                    : undefined
                }
                onClick={() => setWay(name, null)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="add"
          onClick={() => {
            let name = 'colourway';
            for (let n = 2; scheme.colorways[name]; n++) name = `colourway ${n}`;
            setWay(name, ['#3cc8ff', '#ff2d6f', '#ffd23c']);
          }}
        >
          + colourway
        </button>

        <Row gap={14}>
          <Select
            items={ways}
            index={Math.max(0, ways.indexOf(scheme.defaults.colorway))}
            onChange={(i) => patch({ defaults: { ...scheme.defaults, colorway: ways[i] } })}
            name="Fallback"
          />
        </Row>
        <p className="note">
          What a song with no colourway of its own takes. Nothing is ever unstyled — an
          unassigned song going dark would be a black screen for the one thing nobody
          remembered to configure.
        </p>
      </section>
    </>
  );
}
