import { useEffect, useMemo, useState } from 'react';
import type { MilkMode, PresetShelf, Scheme, Show } from '../../protocol.ts';
import { Segmented } from '@openflow/widgets/controls/Segmented.tsx';
import { Select } from '@openflow/widgets/controls/Select.tsx';
import { isMilk, milkId, presetOf } from '../../milk.ts';
import { chooseInput, chosenInput, FROM_SET, listInputs, milkAudio } from '../render/milkAudio.ts';
import { toggleId } from './edits.ts';

const MODES: readonly MilkMode[] = ['off', 'mix', 'only'];
const MODE_ABOUT: Record<MilkMode, string> = {
  off: 'the wheel turns through your flows only',
  mix: 'presets and flows share the wheel',
  only: 'the wheel turns through presets only',
};
/** Rows drawn at once. A library is thousands; a search narrows it to what anyone reads. */
const SHOWN = 300;

/**
 * The MilkDrop library: find a preset, put it up, choose which ones the wheel deals.
 *
 * A preset is put up with `play`, which holds until the wheel's next turn — so
 * browsing during a set is safe, and the show carries on by itself afterwards.
 * Starring narrows `rotation.presets`; with nothing starred the wheel deals from
 * the whole library, the same "empty means everything" every pool here follows.
 */
export function PresetsView({
  show,
  scheme,
  presets,
  edit,
  play,
}: {
  show: Show;
  scheme: Scheme;
  presets: PresetShelf;
  edit(next: Scheme): void;
  play(id: string): void;
}) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [starredOnly, setStarredOnly] = useState(false);
  const mode = scheme.rotation.milk ?? 'only';
  const starred = scheme.rotation.presets ?? [];
  const up = isMilk(show.flow) ? presetOf(show.flow) : null;

  const groups = useMemo(
    () => [...new Set(presets.entries.map((entry) => entry.group))].sort(),
    [presets.entries],
  );
  const matches = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const stars = new Set(starred);
    return presets.entries.filter((entry) => {
      if (group && entry.group !== group) return false;
      if (starredOnly && !stars.has(entry.id)) return false;
      const text = `${entry.name} ${entry.group}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
  }, [presets.entries, query, group, starredOnly, starred]);

  const rotate = (next: Partial<Scheme['rotation']>) =>
    edit({ ...scheme, rotation: { ...scheme.rotation, ...next } });
  const star = (id: string) => {
    const next = toggleId(starred, id, !starred.includes(id));
    rotate({ presets: next });
  };
  const shuffle = () => {
    const pool = matches.length > 0 ? matches : presets.entries;
    if (pool.length > 0) play(milkId(pool[Math.floor(Math.random() * pool.length)].id));
  };

  return (
    <div className="presetsview wdg">
      <div className="bar">
        <Segmented
          items={MODES as unknown as string[]}
          index={MODES.indexOf(mode)}
          onChange={(i) => rotate({ milk: MODES[i] })}
          label="MilkDrop on the wheel"
          title={MODE_ABOUT[mode]}
        />
        <span className="cap">{MODE_ABOUT[mode]}</span>
        <span className="gap" />
        <AudioInput />
      </div>
      <div className="bar">
        <input
          className="search"
          type="search"
          value={query}
          placeholder={`search ${presets.entries.length.toLocaleString()} presets`}
          spellCheck={false}
          aria-label="Search presets"
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <Select
          items={['every folder', ...groups]}
          index={group ? groups.indexOf(group) + 1 : 0}
          onChange={(i) => setGroup(i === 0 ? '' : groups[i - 1])}
          label="Preset folder"
          width={180}
        />
        <button
          type="button"
          className="chip"
          data-on={starredOnly ? '' : undefined}
          aria-pressed={starredOnly}
          onClick={() => setStarredOnly((on) => !on)}
          title="Show only the presets the wheel deals from"
        >
          ★ {starred.length > 0 ? starred.length : 'all'}
        </button>
        <button type="button" className="chip" onClick={shuffle} title="Put a random match up now">
          shuffle
        </button>
        <span className="gap" />
        <span className="cap">
          {matches.length.toLocaleString()} match{matches.length === 1 ? '' : 'es'}
          {matches.length > SHOWN ? ` · first ${SHOWN}` : ''}
        </span>
      </div>
      {presets.notice && <p className="bad pad-line">{presets.notice}</p>}
      <ul className="presets" aria-label="Presets">
        {matches.slice(0, SHOWN).map((entry) => {
          const on = starred.includes(entry.id);
          return (
            <li key={entry.id} data-up={entry.id === up ? '' : undefined}>
              <button
                type="button"
                className="star"
                aria-pressed={on}
                data-on={on ? '' : undefined}
                title={on ? 'Stop the wheel dealing this one' : 'Let the wheel deal this one'}
                onClick={() => star(entry.id)}
              >
                {on ? '★' : '☆'}
              </button>
              <button
                type="button"
                className="name"
                title={`Put ${entry.name} up now — the wheel takes over at its next turn`}
                onClick={() => play(milkId(entry.id))}
              >
                {entry.name}
              </button>
              <span className="group">{entry.group}</span>
            </li>
          );
        })}
      </ul>
      <p className="cap flat foot">
        drop .milk files or folders into {presets.root || 'the preset folder'} — they appear within
        ten seconds. <code>npm run presets:cream</code> fetches projectM's Cream of the Crop pack.
      </p>
    </div>
  );
}

/** Which input presets hear: the set's meters, or an audio device. Per machine. */
function AudioInput() {
  const [inputs, setInputs] = useState<Array<{ id: string; label: string }>>([]);
  const [chosen, setChosen] = useState(chosenInput());
  const [status, setStatus] = useState(milkAudio().status);
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      void listInputs()
        .then((found) => alive && setInputs(found))
        .catch(() => {});
    refresh();
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh);
    const timer = window.setInterval(() => setStatus(milkAudio().status), 1000);
    return () => {
      alive = false;
      navigator.mediaDevices?.removeEventListener?.('devicechange', refresh);
      window.clearInterval(timer);
    };
  }, []);
  const ids = [FROM_SET, ...inputs.map((input) => input.id)];
  return (
    <span className="audio-input" title={status}>
      <Select
        items={['the set (meters + beat)', ...inputs.map((input) => input.label)]}
        index={Math.max(0, ids.indexOf(chosen))}
        onChange={(i) => {
          const id = ids[i] ?? FROM_SET;
          setChosen(id);
          chooseInput(id);
          // Labels arrive with the first permission grant, so ask again after it.
          window.setTimeout(() => void listInputs().then(setInputs).catch(() => {}), 1500);
        }}
        label="What presets hear"
        name="hears"
        width={220}
      />
    </span>
  );
}
