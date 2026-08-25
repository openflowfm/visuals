import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import type {
  LabRoom,
  LabScore,
  LabState,
  LabSubmission,
  Scheme,
  Show,
} from '../../protocol.ts';
import { SCORES, dealRoom, promoteCandidate, submissionProblems } from '../../lab.ts';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { NumberField } from '@openflow/widgets/controls/NumberField.tsx';
import { Select } from '@openflow/widgets/controls/Select.tsx';
import { KEYS } from '../state/useRoom.ts';
import { RESTING, type Clock } from '../state/useShow.ts';
import { useTransport } from '../state/useTransport.ts';
import { BPM, ENERGY, PERCENT } from './param.ts';
import { Bench } from './Preview.tsx';
import { CANDIDATE_FLOW, heardRoom, hexOf, parkedScheme, stagedShow } from './stage.ts';
import { TagPicker } from './TagPicker.tsx';

/**
 * The train view: one candidate at a time, judged like a dive.
 *
 * Not a second launcher and not an arena — candidates do not compete, because
 * a library whose owner likes many kinds of thing has no use for a single
 * ladder. The candidate gets the wall, the judge gives it an anchored score
 * and a useful account of the score, and the next candidate follows. The
 * judgments it writes are what the **review** tab browses afterwards.
 *
 * Everything here draws through the same `Bench` the designer judges flows on,
 * against a **frozen** scheme built from the candidate and its dependency
 * bundle — never the open one, so editing the library later cannot change what
 * an old judgment was looking at. The room is invented, dealt from a seed,
 * adjustable before scoring; whatever room is actually on screen rides the
 * submission, palette by value.
 *
 * **Or the room is the set.** The dealt room proves a candidate under
 * conditions nobody has to stage, but the litmus test is the real music — so
 * when a bridge is connected the source switch hands the stage to the live
 * show: the Link beat, the real meters riding the anchors, the section, the
 * key, the colourway that is actually up. The same rule as always decides
 * what a judgment freezes — the room on screen rides the submission — which
 * for the set means a sample taken at the moment of submit, palette by value,
 * with `live` where a dealt room carries its seed.
 *
 * Closing the view unmounts the `Bench`, which frees its compositor — the one
 * GL context this view owns. Nothing renders, and nothing is dealt, while the
 * view is closed.
 */
export function TrainView({
  show,
  showRef,
  clock,
  canFollow,
  scheme,
  lab,
  labOpen,
  labReview,
  labSkip,
  edit,
}: {
  show: Show;
  showRef: { readonly current: Show };
  clock: Clock;
  /** Whether there is a live show to judge against: a Link clock and a set. */
  canFollow: boolean;
  scheme: Scheme;
  lab: LabState | null;
  labOpen(): void;
  labReview(review: LabSubmission): void;
  labSkip(candidateId: string): void;
  edit(next: Scheme): void;
}) {
  const candidate = lab?.candidate ?? null;

  // Everything judged is keyed to the candidate on the wall: a new deal resets
  // the room, the score, the tags and the note in one place, so a judgment can
  // never be half about the previous candidate.
  const [judging, setJudging] = useState<{
    id: string | null;
    room: LabRoom | null;
    rooms: number;
    score: LabScore | null;
    tags: string[];
    note: string;
    promoted: boolean;
  }>({ id: null, room: null, rooms: 0, score: null, tags: [], note: '', promoted: false });
  const [benchError, setBenchError] = useState<string | null>(null);

  const transport = useTransport(clock, canFollow);
  /** Judging against the set rather than the dealt room. Masked by `canFollow`. */
  const live = transport.following;

  useEffect(() => {
    labOpen();
  }, [labOpen]);

  // A new deal resets the judgment whole and re-tunes the clock to the dealt
  // room, from the top of a bar — so every candidate is met the same way.
  const dealtId = candidate?.id ?? null;
  const dealtRoom = lab?.room ?? null;
  useEffect(() => {
    if (!dealtId) return;
    const room = dealtRoom ?? dealRoom(`room:${dealtId}`);
    setJudging({ id: dealtId, room, rooms: 0, score: null, tags: [], note: '', promoted: false });
    transport.setBpm(room.tempo);
    transport.restart();
  }, [dealtId]); // eslint-disable-line react-hooks/exhaustive-deps

  const room = judging.id === dealtId ? judging.room : null;

  const parked = useMemo(
    (): Scheme | null => (candidate ? parkedScheme(candidate.flow, candidate.bundle) : null),
    [candidate],
  );

  const staged = useMemo(
    (): Show => (room && candidate ? stagedShow(room, candidate.id) : RESTING),
    [room, candidate],
  );

  const reroom = () => {
    if (!candidate) return;
    const next = dealRoom(`room:${candidate.id}~${judging.rooms + 1}`);
    setJudging((held) => ({ ...held, room: next, rooms: held.rooms + 1 }));
    transport.setBpm(next.tempo);
  };

  const setRoom = (patch: Partial<LabRoom>) => {
    setJudging((held) => (held.room ? { ...held, room: { ...held.room, ...patch } } : held));
  };

  const toggleTag = (id: string) => {
    setJudging((held) => ({
      ...held,
      tags: held.tags.includes(id)
        ? held.tags.filter((each) => each !== id)
        : [...held.tags, id],
    }));
  };

  const problems = submissionProblems({ score: judging.score, tags: judging.tags });

  const submit = () => {
    if (!candidate || !room || judging.score === null || problems.length > 0) return;
    labReview({
      candidateId: candidate.id,
      // The room actually judged: the set as heard right now, or the dealt one.
      room: live ? heardRoom(showRef.current) : room,
      score: judging.score,
      tags: judging.tags,
      note: judging.note.trim() || undefined,
    });
  };

  const promote = () => {
    if (!candidate || judging.promoted) return;
    edit(promoteCandidate(scheme, candidate).scheme);
    setJudging((held) => ({ ...held, promoted: true }));
  };

  /** The train view's extra keys on the filter box: 1–5 scores, ⌘⏎ submits. */
  const extraKeys = (event: KeyboardEvent<HTMLInputElement>, search: string): boolean => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
      return true;
    }
    if (search === '' && event.key >= '1' && event.key <= '5') {
      event.preventDefault();
      const score = Number(event.key) as LabScore;
      setJudging((held) => ({ ...held, score }));
      return true;
    }
    return false;
  };

  if (!candidate || !room) {
    return (
      <div className="train train-empty">
        <p>{lab?.notice ?? 'waiting for the lab to deal a candidate…'}</p>
        <Button onPress={labOpen}>ask again</Button>
      </div>
    );
  }

  const nodes = candidate.flow.circuit.nodes.length;

  // The row shows the room being judged: the set's own numbers while
  // following — disabled, because the set owns them — and the dealt room's
  // controls otherwise. The same derivation the designer's header makes.
  const tempo = live ? show.tempo : room.tempo;
  const bpm = Number.isInteger(tempo) ? tempo.toFixed(0) : tempo.toFixed(1);
  const energy = live ? show.master : room.energy;
  const sections = live ? (show.roles.length ? show.roles : ['—']) : room.sections;
  const section = live ? (show.role ?? '—') : room.section;
  const keyAt = live
    ? show.key === null
      ? 0
      : (Math.round(show.key * 12) % 12) + 1
    : room.key === null
      ? 0
      : room.key + 1;
  const palette = live ? show.colors.map(hexOf) : room.colors;
  const playing = live ? show.playing : transport.playing;

  return (
    <div className="train">
      <div className="train-stage">
        <div className="train-frame">
          <Bench
            show={staged}
            scheme={parked!}
            flow={CANDIDATE_FLOW}
            clock={transport}
            live={live ? showRef : null}
            onError={setBenchError}
          />
        </div>
        <div className="train-under">
          <span className="train-name">{candidate.flow.name}</span>
          <span className="train-provenance">
            {nodes} node{nodes === 1 ? '' : 's'} · {candidate.method} v{candidate.methodVersion}
            {candidate.seed ? ` · ${candidate.seed}` : ''} · {candidate.id.slice(0, 12)}
          </span>
          {benchError && <span className="train-error">{benchError}</span>}
        </div>
        <div className="train-room wdg">
          <Button
            tone="quiet"
            label={playing ? 'Hold the clock' : 'Run the clock'}
            title={live ? 'Live owns the clock' : undefined}
            disabled={live}
            onPress={() => transport.setPlaying(!transport.playing)}
          >
            {playing ? '■' : '▶'}
          </Button>
          <Button
            tone="quiet"
            label="Back to the top of the bar"
            onPress={transport.restart}
            disabled={live}
          >
            ↺
          </Button>
          <NumberField
            param={BPM}
            value={tempo}
            onChange={(next) => {
              setRoom({ tempo: next });
              transport.setBpm(next);
            }}
            name="tempo"
            label="Room tempo"
            display={`${bpm} bpm`}
            width={62}
            disabled={live}
          />
          <NumberField
            param={ENERGY}
            value={PERCENT.to(energy)}
            onChange={(value) => setRoom({ energy: PERCENT.from(value) })}
            name="energy"
            width={48}
            disabled={live}
          />
          <Select
            items={[...sections]}
            index={Math.max(0, sections.indexOf(section))}
            onChange={(at) => setRoom({ section: room.sections[at] })}
            name="section"
            width={104}
            disabled={live}
          />
          <Select
            items={['—', ...KEYS]}
            index={keyAt}
            onChange={(at) => setRoom({ key: at === 0 ? null : at - 1 })}
            name="key"
            width={58}
            disabled={live}
            title="What a `song key` node reports; — states none"
          />
          <span
            className="train-palette"
            title={live ? 'the palette that is up' : `room ${room.seed}`}
          >
            {palette.map((hex, at) => (
              <i key={`${hex}${at}`} style={{ background: hex }} />
            ))}
          </span>
          <Button
            tone="quiet"
            onPress={reroom}
            disabled={live}
            title="Deal a different room for the same candidate"
          >
            another room
          </Button>
          <div className="room-source">
            <span className="wdg-caption">source</span>
            <div className="room-source-body" role="radiogroup" aria-label="Judging source">
              <button
                type="button"
                role="radio"
                aria-checked={!live}
                data-on={!live ? '' : undefined}
                title="The dealt room, controls yours"
                onClick={() => transport.setFollowing(false)}
              >
                preview
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={live}
                data-on={live ? '' : undefined}
                disabled={!canFollow}
                title={
                  canFollow
                    ? 'The real music, as it plays'
                    : 'Nothing to follow — no bridge is connected'
                }
                onClick={() => transport.setFollowing(true)}
              >
                live
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="train-judgment wdg">
        <section className="train-scores">
          <h3>score</h3>
          {SCORES.map(({ score, means }) => (
            <button
              key={score}
              type="button"
              className="train-score"
              data-on={judging.score === score ? '' : undefined}
              onClick={() => setJudging((held) => ({ ...held, score }))}
            >
              <b>{score}</b>
              <span>{means}</span>
            </button>
          ))}
        </section>

        <TagPicker
          chosen={judging.tags}
          toggle={toggleTag}
          autoFocus
          placeholder="find a tag — ⏎ adds · 1–5 score · ⌘⏎ submits"
          onKeyExtra={extraKeys}
        />

        <textarea
          className="train-note"
          value={judging.note}
          onChange={(event) => setJudging((held) => ({ ...held, note: event.target.value }))}
          placeholder="a note, if one is worth keeping…"
          aria-label="Review note"
        />

        {lab?.notice && <p className="train-notice">{lab.notice}</p>}
        {problems.length > 0 && judging.score !== null && (
          <p className="train-gate">{problems.join(' · ')}</p>
        )}

        <div className="train-verbs">
          <Button onPress={submit} disabled={judging.score === null || problems.length > 0}>
            submit · next
          </Button>
          <Button tone="quiet" onPress={() => labSkip(candidate.id)} title="Not a judgment — never a score">
            skip
          </Button>
          <span className="gap" />
          <Button
            tone="quiet"
            onPress={promote}
            disabled={judging.promoted}
            title="Copy this candidate into the open scheme — saved by the ordinary save"
          >
            {judging.promoted ? 'promoted ✓' : 'promote to library'}
          </Button>
        </div>
      </div>
    </div>
  );
}
