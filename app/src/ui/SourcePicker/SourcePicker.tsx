import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Popover } from '../Popover/Popover';
import { Icon } from '../Icon/Icon';
import { Meter } from '@satoramoto/zen';
import { Select } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import { CONTROL_FIELD, ControlContext } from '@satoramoto/zen';
import * as api from '../model/api';
import { audioStatus, chooseAudioLane, type AudioLane, type AudioLaneStatus, type AudioStatus } from '../model/audio-api';
import { meterLevel } from '../model/shell';
import { say, Say } from '../model/words';
import './SourcePicker.css';

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
 * The channel choices the folded mixer offers for a source with `count` channels: stereo pairs
 * 1–2, 3–4, …, and an odd last channel (or a lone one) as mono, left and right both that channel.
 */
export function channelPairs(count: number): { label: string; left: number; right: number }[] {
  const out: { label: string; left: number; right: number }[] = [];
  for (let c = 1; c <= Math.max(1, count); c += 2) {
    out.push(c + 1 <= count ? { label: `${c}–${c + 1}`, left: c, right: c + 1 } : { label: `${c}`, left: c, right: c });
  }
  return out;
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
    <span className="vs-meters" data-hint={hint}>
      <Meter value={l} label="left level" width={3} length={44} />
      <Meter value={r} label="right level" width={3} length={44} />
    </span>
  );
}

/** The folded mixer's roomy column; unfolded (Live) the lanes stay as they were, unwrapped. */
function Fold({ on, children }: { on: boolean; children: ReactNode }) {
  return on ? <span className="vs-audio-fold">{children}</span> : <>{children}</>;
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
const OFF: AudioLaneStatus = {
  choice: null,
  channels: 0,
  source: null,
  selected: null,
  enabled: false,
  unavailable: false,
};
// All mounted pickers share command ordering. A poll begun before a choice cannot undo it.
let revision = 0;
let commands: Promise<unknown> = Promise.resolve();

/** Independent main and microphone inputs.
 * Unless `channels="shown"`, the main source's Select sits beside the mixer icon (whose popover holds
 * the channels and the microphone) and the level meter; `folded` moves that Select into the popover,
 * at its top as "Main source", so only the mixer icon and the meter show (Home's header). Live keeps
 * the Select out (default).
 * **Tuning knobs**
 * - `--vs-audio-note-width`: maximum notice width beside the picker.
 * - `--vs-audio-fold-width`: the folded mixer's width (Home), so its Selects aren't squeezed; folded, each
 *   lane's channels are one Select of stereo pairs (the popover is zen's float layer, as every popover is).
 */
export function SourcePicker({
  onError,
  channels: where = 'advanced',
  width = 180,
  trouble = null,
  folded = false,
}: {
  onError(error: unknown): void;
  channels?: 'advanced' | 'shown' | 'none';
  width?: number;
  trouble?: { message: string; detail: string | null } | null;
  folded?: boolean;
}) {
  const [sources, setSources] = useState<api.Source[]>([]);
  const [status, setStatus] = useState<AudioStatus>({ main: OFF, mic: OFF });
  const [problem, setProblem] = useState<string | null>(null);
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
    const off = pending !== null || !source || !heard.enabled || heard.unavailable;
    if (folded) {
      // One Select of stereo pairs (mono for a lone or odd last channel); a choice that's no pair shows as itself first.
      const pairs = channelPairs(count);
      const l = heard.choice?.left ?? 1;
      const r = heard.choice?.right ?? Math.min(2, count);
      const at = pairs.findIndex((p) => p.left === l && p.right === r);
      const odd = at < 0 && heard.choice ? [{ label: l === r ? `${l}` : `${l} / ${r}`, left: l, right: r }] : [];
      const items = [...odd, ...pairs];
      return (
        <Select
          items={items.map((p) => p.label)}
          index={at < 0 ? 0 : at + odd.length}
          onChange={(i) => {
            const p = items[i];
            if (source && heard.choice && p) choose(lane, source, p.left, p.right);
          }}
          label={lane === 'main' ? say('audio channels') : 'microphone audio channels'}
          disabled={off}
        />
      );
    }
    return (
      <span className="vs-audio-channels" role="group" aria-label={lane === 'main' ? say('audio channels') : 'microphone audio channels'}>
        {(['left', 'right'] as const).map((which) => (
          <Select
            key={which}
            items={Array.from({ length: count }, (_, i) => `${which === 'left' ? 'L' : 'R'} ${i + 1}`)}
            index={(heard.choice?.[which] ?? (which === 'left' ? 1 : Math.min(2, count))) - 1}
            onChange={(i) => {
              if (source && heard.choice) choose(lane, source, which === 'left' ? i + 1 : heard.choice.left, which === 'right' ? i + 1 : heard.choice.right);
            }}
            label={lane === 'main' ? `${which} channel` : `microphone ${which} channel`}
            disabled={off}
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
        {denied && <span className="vs-warning vs-audio-note">{denied}</span>}
        {heard.unavailable && (
          <span className="vs-warning vs-audio-note" role="status">
            {heard.problem
              ? heard.problem
              : lane === 'mic'
                ? 'Microphone unavailable; waiting for the selected input.'
                : 'Selected main source unavailable.'}
          </span>
        )}
        {fallback && (
          <span className="vs-warning vs-audio-note" role="status">
            Listening to {heard.choice?.name ?? 'a fallback'} until the main source returns.
          </span>
        )}
      </>
    );
  };
  const mic = (
    <span className="vs-audio-lane" role="group" aria-label="Microphone">
      <Text size="caption" className="vs-audio-lane-name">
        Microphone <span className="vs-audio-optional">optional</span>
      </Text>
      {picker('mic')}
      {channelControls('mic')}
      {notices('mic')}
    </span>
  );
  return (
    <span className={`vs-audio-input ${where === 'shown' ? 'vs-audio-mixer-shown' : ''}`} aria-busy={pending !== null}>
      {where === 'shown' ? (
        <>
          <span className="vs-audio-lane" role="group" aria-label="Main source">
            <Text size="caption" className="vs-audio-lane-name">
              Main source
            </Text>
            {picker('main')}
            {channelControls('main')}
            {notices('main')}
          </span>
          {mic}
          <Text size="caption" className="vs-audio-mix-levels">
            Combined level <Levels />
          </Text>
        </>
      ) : (
        <>
          {!folded && picker('main')}
          {notices('main')}
          <Popover
            name={
              folded
                ? `Audio mixer: ${status.main.enabled ? `listening to ${status.main.choice?.name ?? 'the main source'}` : 'main source off'}${status.mic.enabled ? ' and the microphone' : ''}`
                : 'Audio mixer: main and microphone inputs'
            }
            title={folded ? sourceTitle(status.main.enabled ? (status.main.choice?.name ?? null) : null) : status.mic.enabled ? 'Mixer (main and microphone)' : 'Mixer'}
            // The faders glyph, and "+ mic" while the microphone is mixed in.
            label={
              <>
                <Icon name="mixer" />
                {status.mic.enabled && '+ mic'}
              </>
            }
          >
            {/* The panel floats out of any toolbar the picker sits in: its pickers are fields again. */}
            <ControlContext.Provider value={CONTROL_FIELD}>
              <Fold on={folded}>
                {folded && (
                  <span className="vs-audio-lane" role="group" aria-label="Main source">
                    <Text size="caption" className="vs-audio-lane-name">
                      Main source
                    </Text>
                    {picker('main')}
                  </span>
                )}
                <span className="vs-audio-lane">
                  <Text size="caption" className="vs-audio-lane-name">
                    Main channels
                  </Text>
                  {channelControls('main')}
                </span>
                {mic}
              </Fold>
            </ControlContext.Provider>
          </Popover>
          <Levels />
        </>
      )}
      {pending && (
        <span className="vs-audio-note" role="status">
          Connecting {pending === 'main' ? 'main source' : 'microphone'}…
        </span>
      )}
      {trouble && (
        // The app couldn't read this input: a caution glyph on the input, the whole message in its title.
        <span className="vs-warning vs-audio-trouble" role="alert" aria-label={trouble.message} title={trouble.detail ? `${trouble.message} ${trouble.detail}` : trouble.message}>
          ⚠
        </span>
      )}
      {problem && (
        <span className="vs-warning vs-audio-note" role="alert">
          {problem}
        </span>
      )}
    </span>
  );
}
