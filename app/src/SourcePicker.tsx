import { useCallback, useEffect, useRef, useState } from 'react';
import { Popup } from '@openflow/widgets/chrome/Popup.tsx';
import { Meter } from '@openflow/widgets/music/Meter.tsx';
import { Select } from '@openflow/widgets/controls/Select.tsx';
import * as api from './api.ts';
import { audioStatus, chooseAudioLane, type AudioLane, type AudioLaneStatus, type AudioStatus } from './audio-api.ts';
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

/**
 * The source picker's tooltip: the full name of what it shows first (the
 * 560–700 px header cuts the picker to 72 px, and a device's name with it),
 * then what it can pick. `shown` is null while nothing is heard.
 */
export function sourceTitle(shown: string | null): string {
  const choices = `${say('process tap')}, ${EVERYTHING}, or a microphone or interface`;
  return shown ? `${Say('audio input')}: ${shown}. Or pick ${choices}` : `${Say('audio input')}: ${choices}`;
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

/** Match identities, never a display name when native identity is available. */
export function sameSource(a: api.SourceId | null, b: api.SourceId | null): boolean {
  if (!a || !b || a.kind !== b.kind) return a === b;
  if (a.kind === 'system') return true;
  if (a.kind === 'app' && b.kind === 'app') return a.bundle === b.bundle;
  if (a.kind === 'device' && b.kind === 'device') {
    const auid = (a as typeof a & { uid?: string }).uid;
    const buid = (b as typeof b & { uid?: string }).uid;
    return auid && buid ? auid === buid : a.name === b.name && a.size === b.size;
  }
  return false;
}
const OFF: AudioLaneStatus = { choice: null, channels: 0, source: null, selected: null, enabled: false, unavailable: false };
// All mounted pickers share command ordering. A poll begun before a choice cannot undo it.
let revision = 0;
let commands: Promise<unknown> = Promise.resolve();

export function SourcePicker({ onError, channels: where = 'advanced', width = 180 }: { onError(error: unknown): void; channels?: 'advanced' | 'shown' | 'none'; width?: number }) {
  const [sources, setSources] = useState<api.Source[]>([]);
  const [status, setStatus] = useState<AudioStatus>({ main: OFF, mic: OFF });
  const [problem, setProblem] = useState<string | null>(null);
  const [mixerOpen, setMixerOpen] = useState(false);
  const mixerButton = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState<AudioLane | null>(null);
  const busy = useRef(false);
  const alive = useRef(false);
  const request = useRef(0);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const refresh = useCallback(async () => {
    const ticket = ++request.current;
    const version = revision;
    try {
      const [list, now] = await Promise.all([api.audioSources(), audioStatus()]);
      if (!alive.current || busy.current || ticket !== request.current || version !== revision) return;
      setSources(list.sources ?? []);
      if (now) setStatus(now);
    } catch (e) {
      if (alive.current && ticket === request.current && version === revision) errorRef.current(e);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await refresh();
      if (alive.current) timer = setTimeout(tick, EVERY);
    };
    void tick();
    return () => {
      alive.current = false;
      request.current++;
      clearTimeout(timer);
    };
  }, [refresh]);

  const choose = (lane: AudioLane, source: api.Source | null, left = 1, right = 2) => {
    if (busy.current) return;
    busy.current = true;
    revision++;
    request.current++;
    setPending(lane);
    setProblem(null);
    commands = commands
      .catch(() => {})
      .then(() => chooseAudioLane(lane, source?.id ?? null, left, right))
      .then(
        (now) => {
          if (alive.current) setStatus(now);
        },
        (e) => {
          if (alive.current) setProblem(`${lane === 'main' ? 'Main source' : 'Microphone'}: ${String(e)}`);
        },
      )
      .finally(() => {
        revision++;
        busy.current = false;
        if (alive.current) {
          setPending(null);
          void refresh();
        }
      });
  };

  const sourceList = (lane: AudioLane) => sources.filter((s) => lane === 'main' || s.id.kind === 'device');
  const picker = (lane: AudioLane) => {
    const heard = status[lane];
    const list = sourceList(lane);
    const at = list.findIndex((s) => sameSource(s.id, heard.selected));
    const missing = heard.enabled && at < 0;
    const missingName = heard.selected?.kind === 'device' ? heard.selected.name : (heard.choice?.name ?? 'Selected source');
    const items = ['Off', ...(missing ? [`${missingName} (unavailable)`] : []), ...list.map(label)];
    const shown = heard.choice?.name ?? null;
    return (
      <Select
        items={items}
        index={!heard.enabled ? 0 : missing ? 1 : at + 1}
        onChange={(i) => {
          if (i === 0) {
            choose(lane, null);
            return;
          }
          const next = list[i - 1 - Number(missing)];
          if (next) choose(lane, next, ...keepChannels(heard.choice, next));
        }}
        label={lane === 'main' ? say('audio input') : 'microphone input'}
        title={lane === 'main' ? sourceTitle(at >= 0 ? label(list[at]) : shown) : 'Optional microphone or interface, mixed with the main source'}
        width={width}
        disabled={pending !== null}
      />
    );
  };
  const channelControls = (lane: AudioLane) => {
    const heard = status[lane];
    const source = sources.find((s) => sameSource(s.id, heard.source));
    const count = heard.channels || 2;
    return (
      <span className="audio-channels" role="group" aria-label={lane === 'main' ? say('audio channels') : 'microphone audio channels'}>
        {(['left', 'right'] as const).map((which) => (
          <Select
            key={which}
            items={Array.from({ length: count }, (_, i) => `${which === 'left' ? 'L' : 'R'} ${i + 1}`)}
            index={(heard.choice?.[which] ?? (which === 'left' ? 1 : Math.min(2, count))) - 1}
            onChange={(i) => {
              if (source && heard.choice) choose(lane, source, which === 'left' ? i + 1 : heard.choice.left, which === 'right' ? i + 1 : heard.choice.right);
            }}
            label={lane === 'main' ? `${which} channel` : `microphone ${which} channel`}
            disabled={pending !== null || !source || !heard.enabled || heard.unavailable}
          />
        ))}
      </span>
    );
  };
  const notices = (lane: AudioLane) => {
    const heard = status[lane];
    const denied = deniedNote(heard);
    const fallback = heard.enabled && heard.source && !sameSource(heard.source, heard.selected);
    return (
      <>
        {denied && <span className="vf-warning audio-note">{denied}</span>}
        {heard.unavailable && (
          <span className="vf-warning audio-note" role="status">
            {lane === 'mic' ? 'Microphone unavailable; waiting for the selected input.' : 'Selected main source unavailable.'}
          </span>
        )}
        {fallback && (
          <span className="vf-warning audio-note" role="status">
            Listening to {heard.choice?.name ?? 'a fallback'} until the main source returns.
          </span>
        )}
      </>
    );
  };
  const mic = (
    <span className="audio-lane" role="group" aria-label="Microphone">
      <span className="audio-lane-name">
        Microphone <span className="audio-optional">optional</span>
      </span>
      {picker('mic')}
      {channelControls('mic')}
      {notices('mic')}
    </span>
  );
  return (
    <span className={`audio-input ${where === 'shown' ? 'audio-mixer-shown' : ''}`} aria-busy={pending !== null}>
      {where === 'shown' ? (
        <>
          <span className="audio-lane" role="group" aria-label="Main source">
            <span className="audio-lane-name">Main source</span>
            {picker('main')}
            {channelControls('main')}
            {notices('main')}
          </span>
          {mic}
          <span className="audio-mix-levels">
            Combined level <Levels />
          </span>
        </>
      ) : (
        <>
          {picker('main')}
          <span className="audio-advanced">
            <button
              type="button"
              ref={mixerButton}
              className="audio-mixer-toggle"
              aria-expanded={mixerOpen}
              aria-label="Audio mixer: main and microphone inputs"
              title="Mix a microphone with the main source"
              onClick={() => setMixerOpen((open) => !open)}
            >
              Mixer{status.mic.enabled ? ' + mic' : ''}
            </button>
            {mixerOpen && (
              <Popup
                anchor={mixerButton}
                role="group"
                label="Audio mixer"
                className="audio-advanced-body"
                onDismiss={(how) => {
                  setMixerOpen(false);
                  if (how === 'escape') mixerButton.current?.focus();
                }}
              >
                <span className="audio-lane">
                  <span className="audio-lane-name">Main channels</span>
                  {channelControls('main')}
                  {notices('main')}
                </span>
                {mic}
              </Popup>
            )}
          </span>
          <Levels />
        </>
      )}
      {pending && (
        <span className="audio-note" role="status">
          Connecting {pending === 'main' ? 'main source' : 'microphone'}…
        </span>
      )}
      {problem && (
        <span className="vf-warning audio-note" role="alert">
          {problem}
        </span>
      )}
    </span>
  );
}
