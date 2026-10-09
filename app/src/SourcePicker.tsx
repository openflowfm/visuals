import { useCallback, useEffect, useRef, useState } from 'react';
import { Meter } from '@openflow/widgets/music/Meter.tsx';
import { Select } from '@openflow/widgets/controls/Select.tsx';
import * as api from './api.ts';
import { meterLevel } from './shell.ts';
import { say, Say } from './words.ts';
import './audio.css';

/** How often the sources are read again, so a DAW opened or an interface plugged in shows up. */
const EVERY = 2000;

/** What the app calls the whole Mac's sound (`listen::EVERYTHING`). */
const EVERYTHING = 'everything on this Mac';

/**
 * Which of `sources` is being heard: the one named as `heard` says, told apart
 * by channel count when it's an input (macOS names every aggregate device
 * "Aggregate Device"). -1 when none is.
 */
export function current(sources: api.Source[], heard: api.Heard['choice']): number {
  if (!heard) return -1;
  return sources.findIndex((s) => s.name === heard.name && (s.id.kind !== 'device' || s.id.size === heard.size));
}

/** How the picker lists a source: an input with its channel count, an app or the whole Mac by name. */
export function label(source: api.Source): string {
  return source.id.kind === 'device' ? `${source.name} (${source.channels} ch)` : source.name;
}

/**
 * What to say when the app stopped hearing `was` by itself and hears `now`
 * instead because `was` went away (an app quit, an interface unplugged).
 * Nothing when `was` is still listed: the app went back to what was chosen.
 */
export function goneNote(was: string | null, now: string | null, sources: api.Source[]): string | null {
  if (!was || !now || was === now || sources.some((s) => s.name === was)) return null;
  return `${was} is gone, so listening to ${now} until it's back`;
}

/** What to say when macOS refused the tap other apps' sound; null when it didn't. */
export function deniedNote(heard: api.Heard): string | null {
  return heard.denied ? 'not allowed to hear other apps: allow it in System Settings › Privacy & Security › Screen & System Audio Recording' : null;
}

/** Channels to keep when moving to `next`: the same pair when it has them, else its first two. */
export function keepChannels(choice: api.Heard['choice'], next: api.Source): [number, number] {
  if (choice && choice.left <= next.channels && choice.right <= next.channels) return [choice.left, choice.right];
  return [1, Math.min(2, Math.max(1, next.channels))];
}

/**
 * The left and right levels. A leaf of its own: it re-renders twenty times a
 * second, and nothing else around it has to.
 */
function Levels() {
  const [[l, r], setLevels] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    let live = true;
    const tick = async () => {
      while (live) {
        const [nl, nr] = await api.levels().catch(() => [0, 0] as [number, number]);
        if (!live) return;
        const next: [number, number] = [meterLevel(nl), meterLevel(nr)];
        // Silence stays silent without a render.
        setLevels((was) => (was[0] === next[0] && was[1] === next[1] ? was : next));
        await new Promise((done) => setTimeout(done, 50));
      }
    };
    tick();
    return () => {
      live = false;
    };
  }, []);
  const hint = 'what the presets hear, left above right: −60 dB empty to 0 dB full';
  return (
    <span className="vf-meters" data-hint={hint}>
      <Meter value={l} label="left level" width={4} length={44} />
      <Meter value={r} label="right level" width={4} length={44} />
    </span>
  );
}

/**
 * What the app listens to: your DAW (named when one is running), everything on
 * this Mac, another app playing sound, or a microphone or interface
 * (`api.audioSources`, `api.listenToSource`), with a meter so a quiet source is
 * obvious before a preset looks dead. Which two channels are left and right
 * sits under Advanced. The choice is the app's — saved, and back next launch —
 * so this only reads it and asks for changes. The sources are read again every
 * couple of seconds, which is also when the app notices a source gone and
 * falls back, or one back and returns to it.
 */
export function SourcePicker({ onError }: { onError(error: unknown): void }) {
  const [sources, setSources] = useState<api.Source[] | null>(null);
  const [heard, setHeard] = useState<api.Heard>({ choice: null, channels: 0 });
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Held in a ref so a caller passing a new function each render doesn't refetch (or loop on a failure).
  const errorRef = useRef(onError);
  errorRef.current = onError;
  // What was heard last, and whether this picker asked for a change since.
  const last = useRef<string | null>(null);
  const asked = useRef(false);

  const refresh = useCallback(async () => {
    const [list, now] = await Promise.all([
      api.audioSources().catch(() => null),
      api.listening().catch((e) => {
        errorRef.current(e);
        return null;
      }),
    ]);
    if (list) setSources((was) => (was && JSON.stringify(was) === JSON.stringify(list.sources) ? was : list.sources));
    if (!now) return;
    const name = now.choice?.name ?? null;
    if (name !== last.current) {
      // A change asked for here needs no note; one the app made says why, or clears the note when it went back.
      setNote(asked.current || !list ? null : goneNote(last.current, name, list.sources));
      last.current = name;
    }
    asked.current = false;
    setHeard((was) => (JSON.stringify(was) === JSON.stringify(now) ? was : now));
  }, []);

  useEffect(() => {
    let live = true;
    const tick = async () => {
      while (live) {
        await refresh();
        await new Promise((done) => setTimeout(done, EVERY));
      }
    };
    tick();
    return () => {
      live = false;
    };
  }, [refresh]);

  const choice = heard.choice;
  const denied = deniedNote(heard);
  const list = sources ?? [];
  const at = current(list, choice);

  const choose = (source: api.Source, l: number, r: number) => {
    asked.current = true;
    return api.listenToSource(source.id, l, r).then(
      () => {
        setProblem(null);
        setNote(null);
        refresh();
      },
      (e) => setProblem(`${source.name}: ${String(e)}`),
    );
  };

  // Nothing to listen to at all: say what to do instead of an empty picker.
  if (sources && sources.length === 0) {
    return (
      <span className="audio-input">
        <span className="vf-warning" title="The presets react to sound. Connect a microphone or an audio interface, or allow microphone access in System Settings › Privacy & Security.">
          nothing to listen to: connect a microphone or interface
        </span>
      </span>
    );
  }

  const count = heard.channels || 2;
  const channels = Array.from({ length: count }, (_, i) => i + 1);
  const channel = (which: 'left' | 'right') => {
    const n = choice?.[which] ?? (which === 'left' ? 1 : 2);
    return (
      <Select
        items={channels.map((c) => `${which === 'left' ? 'L' : 'R'} ${c}`)}
        index={n - 1}
        onChange={(i) => {
          const source = list[at];
          if (!source || !choice) return;
          const c = i + 1;
          choose(source, which === 'left' ? c : choice.left, which === 'right' ? c : choice.right);
        }}
        label={`${which} channel`}
        title={`which of the source's channels the presets hear as ${which}`}
        disabled={!choice || at < 0}
      />
    );
  };

  // What the app hears but no longer lists (or nothing yet) is shown first, by name.
  const missing = at < 0;
  const items = [...(missing ? [choice?.name ?? `choose what to ${say('audio input')}`] : []), ...list.map(label)];

  return (
    <span className="audio-input">
      <Select
        items={items}
        index={missing ? 0 : at}
        onChange={(i) => {
          const next = list[missing ? i - 1 : i];
          if (!next) return;
          // Keep the channels when the next source has them — moving between two
          // interfaces wired the same way shouldn't need choosing twice.
          const [l, r] = keepChannels(choice, next);
          choose(next, l, r);
        }}
        label={say('audio input')}
        title={`${Say('audio input')}: ${say('process tap')}, ${EVERYTHING}, or a microphone or interface`}
        width={180}
      />
      <details className="audio-advanced">
        <summary title="which two of the source's channels are left and right">Advanced</summary>
        <span className="audio-advanced-body">
          {channel('left')}
          {channel('right')}
        </span>
      </details>
      <Levels />
      {denied && (
        <span className="vf-warning audio-note" title={denied}>
          {denied}
        </span>
      )}
      {note && (
        <span className="vf-warning audio-note" title={note}>
          {note}
        </span>
      )}
      {problem && (
        <span className="vf-warning audio-note" title={problem}>
          {problem}
        </span>
      )}
    </span>
  );
}
